module.exports = (req, res, next) => {
  const startedAt = Date.now();
  // Webhook tokenları and davet kodları URL'nin parçasıdır. Ham yolu loglamak
  // bu erişim anahtarlarını terminale veya kalıcı log toplayıcısına sızdırır.
  const safePath = String(req.path || '/')
    .replace(/(\/api\/webhooks\/[^/]+\/)[^/]+(?=\/messages(?:\/|$))/i, '$1[REDACTED]')
    .replace(/(\/api\/invites\/)[^/]+(?=\/|$)/i, '$1[REDACTED]');
  res.once('finish', () => {
    console.log(`📝 ${new Date().toISOString()} ${req.method} ${safePath} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
};
