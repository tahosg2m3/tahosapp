module.exports = (req, res, next) => {
  const timestamp = new Date().toISOString();
  // Webhook tokenları and davet kodları URL'nin parçasıdır. Ham yolu loglamak
  // bu erişim anahtarlarını terminale veya kalıcı log toplayıcısına sızdırır.
  const safePath = String(req.path || '/')
    .replace(/(\/api\/webhooks\/[^/]+\/)[^/]+(?=\/messages(?:\/|$))/i, '$1[REDACTED]')
    .replace(/(\/api\/invites\/)[^/]+(?=\/|$)/i, '$1[REDACTED]');
  console.log(`📝 ${timestamp} ${req.method} ${safePath}`);
  next();
};
