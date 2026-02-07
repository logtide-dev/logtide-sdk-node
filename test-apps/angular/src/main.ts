import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

try {
  const { hub, GlobalErrorIntegration } = await import('@logtide/core');
  hub.init({
    dsn: 'http://lp_testkey@127.0.0.1:9103/test-project',
    service: 'test-angular',
    environment: 'test',
    batchSize: 1,
    flushInterval: 500,
    integrations: [new GlobalErrorIntegration()],
  });
} catch (err) {
  console.error('LogTide init failed:', err);
}

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
