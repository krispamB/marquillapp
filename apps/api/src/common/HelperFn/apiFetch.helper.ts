import { Console } from 'console';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public data: any,
  ) {
    super(`HTTP error! status: ${statusCode} ${statusText}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(url, options);

  if (!response.ok) {
    let errorData;
    const responseText = await response.text();
    try {
      errorData = JSON.parse(responseText);
    } catch {
      errorData = responseText;
    }
    throw new ApiError(response.status, response.statusText, errorData);
  }

  const responseText = await response.text();
  let data: T;

  if (!responseText) {
    data = {} as T;
  } else {
    try {
      data = JSON.parse(responseText) as T;
    } catch {
      data = responseText as unknown as T;
    }
  }

  return { data, response };
}
