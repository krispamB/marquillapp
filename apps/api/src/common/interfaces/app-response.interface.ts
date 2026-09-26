export interface IAppResponse {
  statusCode: number;
  message: string;
  data?: any;
  filters?: any;
  page?: number;
  pages?: number;
}
