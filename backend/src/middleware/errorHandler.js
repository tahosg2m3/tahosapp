module.exports = (err, req, res, next) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  console.error('Request failed:', isDevelopment ? err : err?.message || 'Internal server error');

  const multerMessages = {
    LIMIT_FILE_SIZE: 'Files can be at most 10 MB.',
    LIMIT_FILE_COUNT: 'Only one file can be uploaded at a time.',
    LIMIT_UNEXPECTED_FILE: 'The file field or file type is invalid.',
    LIMIT_PART_COUNT: 'The upload request contains too many parts.',
  };
  const isMulterError = err?.name === 'MulterError';
  const requestedStatus = Number(err?.status || err?.statusCode);
  const status = isMulterError
    ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
    : (Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 500 ? requestedStatus : 500);
  const message = isMulterError
    ? (multerMessages[err.code] || 'The file upload request is invalid.')
    : (status < 500 ? String(err.message || 'Invalid request.') : 'An unexpected server error occurred.');

  res.status(status).json({
    error: message,
    ...(isDevelopment && { stack: err.stack }),
  });
};
