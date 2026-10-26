export function planWhatsAppGroupIdentityBackfill(records, connections) {
  const connectionsByScope = new Map();
  for (const connection of connections) {
    const key = `${connection.workspace_id}\u0000${connection.instance_name}`;
    const entries = connectionsByScope.get(key) ?? [];
    entries.push(connection);
    connectionsByScope.set(key, entries);
  }

  const identities = new Map();
  const assignments = [];
  const issues = [];
  for (const record of records) {
    const scopeKey = `${record.workspace_id}\u0000${record.instance_name}`;
    const matchingConnections = connectionsByScope.get(scopeKey) ?? [];
    if (
      matchingConnections.length !== 1 ||
      matchingConnections[0].owner_id !== record.owner_id
    ) {
      issues.push({
        sourceTable: record.source_table,
        sourceRowId: record.source_row_id,
        workspaceId: record.workspace_id,
        ownerId: record.owner_id,
        instanceName: record.instance_name,
        groupJid: record.group_jid,
        reason:
          matchingConnections.length === 0
            ? "CONNECTION_NOT_FOUND"
            : matchingConnections.length > 1
              ? "CONNECTION_AMBIGUOUS"
              : "OWNER_CONNECTION_MISMATCH",
      });
      continue;
    }

    const identityKey = `${scopeKey}\u0000${record.group_jid}`;
    let identity = identities.get(identityKey);
    if (!identity) {
      identity = {
        workspaceId: record.workspace_id,
        ownerId: record.owner_id,
        instanceName: record.instance_name,
        groupJid: record.group_jid,
        kind: "unknown",
        name: record.group_jid,
        sourceRows: [],
      };
      identities.set(identityKey, identity);
    }
    identity.sourceRows.push({
      sourceTable: record.source_table,
      sourceRowId: record.source_row_id,
    });
    assignments.push({
      sourceTable: record.source_table,
      sourceRowId: record.source_row_id,
      workspaceId: record.workspace_id,
      instanceName: record.instance_name,
      groupJid: record.group_jid,
      identityKey,
    });
  }

  return {
    identities: [...identities.values()],
    assignments,
    issues,
  };
}
