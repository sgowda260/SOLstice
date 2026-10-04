import { DbConnection, tables } from "@/lib/spacetime/module_bindings";

let connectionPromise: Promise<DbConnection> | undefined;

export function getServerSpacetimeConnection() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise<DbConnection>((resolve, reject) => {
    const uri = process.env.SPACETIMEDB_URI ?? process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "ws://127.0.0.1:3001";
    const database = process.env.SPACETIMEDB_DATABASE ?? process.env.NEXT_PUBLIC_SPACETIMEDB_DATABASE ?? "condition-oracle";
    const token = process.env.SPACETIMEDB_SERVER_TOKEN;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, connection?: DbConnection) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        connectionPromise = undefined;
        reject(error);
      } else if (connection) resolve(connection);
    };
    timer = setTimeout(() => finish(new Error("Timed out connecting to SpacetimeDB.")), 15_000);

    const builder = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((connection) => {
        connection.subscriptionBuilder()
          .onApplied(() => finish(undefined, connection))
          .onError((_context, error) => finish(error))
          .subscribe([tables.condition, tables.verificationCheck, tables.evidence, tables.uploadedDocument]);
      })
      .onConnectError((_context, error) => finish(error));

    if (token) builder.withToken(token);
    builder.build();
  });
  return connectionPromise;
}
