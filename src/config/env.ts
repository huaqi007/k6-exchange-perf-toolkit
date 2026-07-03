export function getBaseUrl(): string {
  return __ENV.BASE_URL || 'http://localhost:8080';
}