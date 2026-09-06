// One reading of "which Onshape thing are we pointed at".
//
// Extracted from server.mjs so the write routes and the live verification
// script resolve a context exactly the way a request does, rather than each
// building its own nearly-identical object.
//
// Pure: no config, no clock, no I/O.

export function normalizeContext(input) {
  const source = input instanceof URL ? input.searchParams : input || {};
  const get = (names) => {
    for (const name of names) {
      const value = source instanceof URLSearchParams ? source.get(name) : source[name];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return undefined;
  };

  const documentId = get(['documentId', 'docId', 'did']);
  const elementId = get(['elementId', 'eId', 'eid']);
  let workspaceOrVersion = get(['workspaceOrVersion', 'wvm', 'wv']);
  let workspaceOrVersionId = get([
    'workspaceOrVersionId',
    'workspaceId',
    'versionId',
    'microversionId',
    'wvmId',
    'wid',
    'vid',
    'mid'
  ]);

  if (!workspaceOrVersion) {
    if (get(['versionId', 'vid'])) workspaceOrVersion = 'v';
    else if (get(['microversionId', 'mid'])) workspaceOrVersion = 'm';
    else if (workspaceOrVersionId) workspaceOrVersion = 'w';
  }
  workspaceOrVersion = workspaceOrVersion?.toLowerCase();

  const context = { documentId, workspaceOrVersion, workspaceOrVersionId, elementId };
  context.complete = Boolean(
    documentId && elementId && workspaceOrVersionId && ['w', 'v', 'm'].includes(workspaceOrVersion)
  );
  return context;
}

export function publicContext(context) {
  return {
    documentId: context.documentId,
    workspaceOrVersion: context.workspaceOrVersion,
    workspaceOrVersionId: context.workspaceOrVersionId,
    elementId: context.elementId,
    complete: context.complete
  };
}
