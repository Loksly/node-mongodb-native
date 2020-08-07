import { applyRetryableWrites, applyWriteConcern } from '../utils';
import { MongoError } from '../error';
import { OperationBase } from './operation';
import type { Callback, Document } from '../types';
import type { Collection } from '../collection';
import type { BulkOperationBase } from '../bulk/common';
import type { InsertOptions } from './insert';
import type { ObjectId } from '../bson';

export interface BulkWriteResult {
  /** @property {number} insertedCount Number of documents inserted. */
  insertedCount: number;
  /** @property {number} matchedCount Number of documents matched for update. */
  matchedCount: number;
  /** @property {number} modifiedCount Number of documents modified. */
  modifiedCount: number;
  /** @property {number} deletedCount Number of documents deleted. */
  deletedCount: number;
  /** @property {number} upsertedCount Number of documents upserted. */
  upsertedCount: number;
  /** @property {object} insertedIds Inserted document generated Id's, hash key is the index of the originating operation */
  insertedIds: ObjectId[];
  /** @property {object} upsertedIds Upserted document generated Id's, hash key is the index of the originating operation */
  upsertedIds: ObjectId[];
  /** @property {object} result The command result object. */
  result: Document;
}

export class BulkWriteOperation extends OperationBase {
  collection: Collection;
  operations: Document[];

  constructor(collection: Collection, operations: Document[], options: InsertOptions) {
    super(options);

    this.collection = collection;
    this.operations = operations;
  }

  execute(callback: Callback): void {
    const coll = this.collection;
    const operations = this.operations;
    let options = this.options as InsertOptions;

    // Add ignoreUndefined
    if (coll.s.options.ignoreUndefined) {
      options = Object.assign({}, options);
      options.ignoreUndefined = coll.s.options.ignoreUndefined;
    }

    // Create the bulk operation
    const bulk: BulkOperationBase =
      options.ordered === true || options.ordered == null
        ? coll.initializeOrderedBulkOp(options)
        : coll.initializeUnorderedBulkOp(options);

    // Do we have a collation
    let collation = false;

    // for each op go through and add to the bulk
    try {
      for (let i = 0; i < operations.length; i++) {
        // Get the operation type
        const key = Object.keys(operations[i])[0];
        // Check if we have a collation
        if (operations[i][key].collation) {
          collation = true;
        }

        // Pass to the raw bulk
        bulk.raw(operations[i]);
      }
    } catch (err) {
      return callback(err, null);
    }

    // Final options for retryable writes and write concern
    let finalOptions = Object.assign({}, options);
    finalOptions = applyRetryableWrites(finalOptions, coll.s.db);
    finalOptions = applyWriteConcern(finalOptions, { db: coll.s.db, collection: coll }, options);

    const writeCon = finalOptions.writeConcern ? finalOptions.writeConcern : {};
    const capabilities = coll.s.topology.capabilities();

    // Did the user pass in a collation, check if our write server supports it
    if (collation && capabilities && !capabilities.commandsTakeCollation) {
      return callback(new MongoError('server/primary/mongos does not support collation'));
    }

    // Execute the bulk
    bulk.execute(writeCon, finalOptions, (err, r) => {
      // We have connection level error
      if (!r && err) {
        return callback(err, null);
      }

      r.insertedCount = r.nInserted;
      r.matchedCount = r.nMatched;
      r.modifiedCount = r.nModified || 0;
      r.deletedCount = r.nRemoved;
      r.upsertedCount = r.getUpsertedIds().length;
      r.upsertedIds = {};
      r.insertedIds = {};

      // Update the n
      r.n = r.insertedCount;

      // Inserted documents
      const inserted = r.getInsertedIds();
      // Map inserted ids
      for (let i = 0; i < inserted.length; i++) {
        r.insertedIds[inserted[i].index] = inserted[i]._id;
      }

      // Upserted documents
      const upserted = r.getUpsertedIds();
      // Map upserted ids
      for (let i = 0; i < upserted.length; i++) {
        r.upsertedIds[upserted[i].index] = upserted[i]._id;
      }

      // Return the results
      callback(undefined, r);
    });
  }
}
