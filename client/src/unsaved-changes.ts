type UnsavedChangeKind = 'review' | 'announcement';

const unsavedChanges: Record<UnsavedChangeKind, boolean> = {
  review: false,
  announcement: false,
};

export function setUnsavedChange(kind: UnsavedChangeKind, isUnsaved: boolean) {
  unsavedChanges[kind] = isUnsaved;
}

export function hasUnsavedChanges() {
  return Object.values(unsavedChanges).some(Boolean);
}

export function confirmLeavingWithUnsavedChanges() {
  if (!hasUnsavedChanges()) return true;

  const pending: string[] = [];
  if (unsavedChanges.review) pending.push('review field changes');
  if (unsavedChanges.announcement) pending.push('a new announcement or flyer');
  return window.confirm(`You have unsaved ${pending.join(' and ')}. Leave without saving?`);
}
