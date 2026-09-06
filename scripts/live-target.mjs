/** Public captures use these reserved example ids, never live targets. */
export function isExampleOnshapeId(id) {
  return /^(?:a11ce\d{19}|0{24})$/i.test(String(id));
}

/** No personal folder default: the operator must configure their own scratch folder. */
export function resolveScratchTarget(settings) {
  const id = settings?.scratchFolderId;
  if (settings?.allowDocumentCreation === false || !/^[a-f0-9]{24}$/i.test(String(id)) || isExampleOnshapeId(id)) {
    return { allowed: false, parentId: null };
  }
  return { allowed: true, parentId: id };
}

export function requireScratchFolder(settings) {
  const target = resolveScratchTarget(settings);
  if (!target.allowed) throw new Error('Enable scratch document creation and configure your own valid scratch folder in Settings. Public example identifiers cannot be used as live targets.');
  return target.parentId;
}
