import { defineAspects, Aspect, OperationBase } from './operation';
import { updateDocuments, updateCallback } from './common_functions';
import { hasAtomicOperators, MongoDBNamespace } from '../utils';
import { CommandOperation, CommandOperationOptions } from './command';
import type { Callback, Document } from '../types';
import type { Server } from '../sdam/server';
import type { Collection } from '../collection';
import type { CollationOptions, WriteCommandOptions } from '../cmap/wire_protocol/write_command';
import type { Connection } from '../cmap/connection';
import type { ObjectId } from '../bson';
import type { BinMsg, Response } from '../cmap/commands';

export interface UpdateOptions extends CommandOperationOptions {
  /** A set of filters specifying to which array elements an update should apply */
  arrayFilters?: Document[];
  /** If true, allows the write to opt-out of document level validation */
  bypassDocumentValidation?: boolean;
  /** Specifies a collation */
  collation?: CollationOptions;
  /** Specify that the update query should only consider plans using the hinted index */
  hint?: string | Document;
  /** When true, creates a new document if no document matches the query */
  upsert?: boolean;

  // non-standard options
  retryWrites?: boolean;
  multi?: boolean;
}

export interface UpdateResult {
  /** The number of documents that matched the filter */
  matchedCount: number;
  /** The number of documents that were modified */
  modifiedCount: number;
  /** The number of documents upserted */
  upsertedCount: number;
  /** The upserted id */
  upsertedId: ObjectId;

  // FIXME: remove these internal details
  /** @property {object} message The raw msg response wrapped in an internal class */
  message: BinMsg | Response;
  /** @property {object[]} [ops] In a response to {@link Collection#replaceOne replaceOne}, contains the new value of the document on the server. This is the same document that was originally passed in, and is only here for legacy purposes. */
  ops: Document[];
  /** @property {object} result The raw result returned from MongoDB. Will vary depending on server version. */
  result: Document;
  /** The connection object used for the operation */
  connection: Connection;
}

export class UpdateOperation extends OperationBase<UpdateOptions> {
  namespace: MongoDBNamespace;
  operations: Document[];

  constructor(ns: MongoDBNamespace, ops: Document[], options: UpdateOptions) {
    super(options);
    this.namespace = ns;
    this.operations = ops;
  }

  get canRetryWrite(): boolean {
    return this.operations.every(op => op.multi == null || op.multi === false);
  }

  execute(server: Server, callback: Callback): void {
    server.update(
      this.namespace.toString(),
      this.operations,
      this.options as WriteCommandOptions,
      callback
    );
  }
}

export class UpdateOneOperation extends CommandOperation<UpdateOptions> {
  collection: Collection;
  filter: Document;
  update: Document;

  constructor(collection: Collection, filter: Document, update: Document, options: UpdateOptions) {
    super(collection, options);

    if (!hasAtomicOperators(update)) {
      throw new TypeError('Update document requires atomic operators');
    }

    this.collection = collection;
    this.filter = filter;
    this.update = update;
  }

  execute(server: Server, callback: Callback): void {
    const coll = this.collection;
    const filter = this.filter;
    const update = this.update;
    const options = this.options;

    // Set single document update
    options.multi = false;
    // Execute update
    updateDocuments(server, coll, filter, update, options, (err, r) =>
      updateCallback(err, r, callback)
    );
  }
}

export class UpdateManyOperation extends CommandOperation<UpdateOptions> {
  collection: Collection;
  filter: Document;
  update: Document;

  constructor(collection: Collection, filter: Document, update: Document, options: UpdateOptions) {
    super(collection, options);

    this.collection = collection;
    this.filter = filter;
    this.update = update;
  }

  execute(server: Server, callback: Callback): void {
    const coll = this.collection;
    const filter = this.filter;
    const update = this.update;
    const options = this.options;

    // Set single document update
    options.multi = true;
    // Execute update
    updateDocuments(server, coll, filter, update, options, (err, r) =>
      updateCallback(err, r, callback)
    );
  }
}

defineAspects(UpdateOperation, [
  Aspect.RETRYABLE,
  Aspect.WRITE_OPERATION,
  Aspect.EXECUTE_WITH_SELECTION
]);

defineAspects(UpdateOneOperation, [
  Aspect.RETRYABLE,
  Aspect.WRITE_OPERATION,
  Aspect.EXECUTE_WITH_SELECTION
]);

defineAspects(UpdateManyOperation, [Aspect.WRITE_OPERATION, Aspect.EXECUTE_WITH_SELECTION]);
