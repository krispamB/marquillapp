export interface IAppResponse {
  statusCode: number;
  message: string;
  data?: any;
  page?: number;
  pages?: number;
}
