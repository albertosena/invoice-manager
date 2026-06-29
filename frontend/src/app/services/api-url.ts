const { hostname, port } = window.location;

export const API_BASE =
  hostname === 'localhost' || hostname === '127.0.0.1'
    ? port === '4200'
      ? `http://${hostname}:5000/api`
      : '/api'
    : '/api';
