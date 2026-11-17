function shouldShowGuestPage(status, accessibleWorkspaceCount = 1) {
  return status === 403 || (status === 200 && accessibleWorkspaceCount === 0);
}

module.exports = { shouldShowGuestPage };
