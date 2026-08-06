export type UploadProgressHandler = (loadedBytes: number) => void;

export type UploadFileToUrl = (
  uploadUrl: string,
  requiredHeaders: Record<string, string>,
  file: File,
  onProgress: UploadProgressHandler,
) => Promise<void>;

export function aggregateUploadProgress(
  loadedBytesByFile: number[],
  files: Array<Pick<File, "size">>,
) {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes === 0) return 100;
  const loadedBytes = loadedBytesByFile.reduce((total, loaded, index) => (
    total + Math.min(Math.max(loaded, 0), files[index]?.size ?? 0)
  ), 0);
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
}

export const uploadFileToUrl: UploadFileToUrl = (uploadUrl, requiredHeaders, file, onProgress) => (
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    Object.entries(requiredHeaders).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size);
        resolve();
        return;
      }
      reject(new Error(`Upload failed for ${file.name}.`));
    };
    request.onerror = () => reject(new Error(`Upload failed for ${file.name}.`));
    request.onabort = () => reject(new Error(`Upload was cancelled for ${file.name}.`));
    request.send(file);
  })
);
