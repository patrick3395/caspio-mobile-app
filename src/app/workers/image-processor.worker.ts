/// <reference lib="webworker" />

addEventListener('message', ({ data }) => {
  const { id, type, blob } = data || {};

  if (typeof id !== 'number') {
    postMessage({ id, success: false, error: 'Missing task identifier' });
    return;
  }

  try {
    if (type === 'BLOB_TO_DATA_URL') {
      if (!(blob instanceof Blob)) {
        throw new Error('Invalid blob passed to worker');
      }
      const reader = new FileReaderSync();
      const result = reader.readAsDataURL(blob);
      postMessage({ id, success: true, result });
    } else {
      postMessage({ id, success: false, error: `Unknown worker task: ${type}` });
    }
  } catch (error: any) {
    postMessage({ id, success: false, error: error?.message || String(error) });
  }
});
