function weddingWorkspacePath(slug) {
  return `/${encodeURIComponent(String(slug || "").trim())}`;
}

function isWeddingMainAdmin(email, mainAdminEmail) {
  return Boolean(email && mainAdminEmail && email.trim().toLowerCase() === mainAdminEmail.trim().toLowerCase());
}

module.exports = { weddingWorkspacePath, isWeddingMainAdmin };
