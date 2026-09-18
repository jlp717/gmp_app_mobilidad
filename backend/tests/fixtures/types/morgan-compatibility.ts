import morgan from 'morgan';

const middleware = morgan('combined', {
  stream: {
    write(_message: string): void {},
  },
});

void middleware;
