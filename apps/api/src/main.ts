import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import compression from 'compression';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// Node gives each address only 250 ms by default. Where IPv6 is unreachable and
// IPv4 takes longer than that, every attempt fails and fetch throws ETIMEDOUT
// even though the host is up.
const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;

async function bootstrap() {
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger(
    bootstrap.name.charAt(0).toUpperCase() + bootstrap.name.slice(1),
  );
  app.use(
    helmet({
      // The API serves JSON, plus one HTML page (the LinkedIn OAuth callback)
      // that sets its own nonce-based policy. Nothing else may load or frame.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // The web app watches `popup.closed` on the LinkedIn callback popup; a
      // Cross-Origin-Opener-Policy would sever that handle mid-flow.
      crossOriginOpenerPolicy: false,
      xFrameOptions: { action: 'deny' },
    }),
  );
  app.enableCors({
    origin: [process.env.FRONTEND_URL, process.env.FRONTEND_URL_DEV],
    credentials: true,
  });

  app.use(
    compression({
      filter: (req, res) => {
        // The SSE progress stream must not be gzipped: compression buffers the
        // stream to build its window and would stall live progress.
        if (req.path.includes('/runs/') && req.path.endsWith('/events'))
          return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.use(cookieParser());

  const PORT = process.env.PORT || 3500;
  await app.listen(PORT, () => {
    logger.log(
      `Running API in MODE: ${process.env.NODE_ENV} on Port: [${PORT}]`,
    );
  });
}
bootstrap();
