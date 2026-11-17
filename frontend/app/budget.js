const EMPTY_OBJECT_ID = "000000000000000000000000";

function isBudgetRoot(record) {
  return !record.parentId || record.parentId === EMPTY_OBJECT_ID;
}

function isBudgetChild(record) {
  return Boolean(record.parentId) && record.parentId !== EMPTY_OBJECT_ID;
}

function getBudgetRoots(records) {
  return records.filter(isBudgetRoot);
}

function getBudgetChildren(records) {
  return records.filter(isBudgetChild);
}

function getBudgetTotal(records) {
  const roots = getBudgetRoots(records);
  return roots.reduce((sum, root) => sum + (root.amount || 0), 0);
}

function matchesBudgetRecord(record, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [record.title, record.event, record.owner, record.details, record.createdByName, record.createdBy]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function filterBudgetRoots(records, query) {
  const roots = getBudgetRoots(records);
  const children = getBudgetChildren(records);
  return roots.filter((root) => matchesBudgetRecord(root, query)
    || children.some((child) => child.parentId === root.id && matchesBudgetRecord(child, query)));
}

function getBudgetSpender(record) {
  return record.createdByName || record.createdBy || "Unknown";
}

function getBudgetBalance(record) {
  return (record.amount || 0) - (record.paidAmount || 0);
}

module.exports = {
  getBudgetRoots,
  getBudgetChildren,
  getBudgetTotal,
  matchesBudgetRecord,
  filterBudgetRoots,
  getBudgetSpender,
  getBudgetBalance,
};
