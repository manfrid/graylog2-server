import request from 'superagent-bluebird-promise';

import StoreProvider from 'injection/StoreProvider';

import ActionsProvider from 'injection/ActionsProvider';
const SessionActions = ActionsProvider.getActions('Session');
const ServerAvailabilityActions = ActionsProvider.getActions('ServerAvailability');

import Routes from 'routing/Routes';
import history from 'util/History';

export class FetchError extends Error {
  constructor(message, additional) {
    super(message);
    this.message = message || (additional.message || 'Undefined error.');
    /* eslint-disable no-console */
    try {
      console.error(`There was an error fetching a resource: ${this.message}.`,
        `Additional information: ${additional.body && additional.body.message ? additional.body.message : 'Not available'}`);
    } catch (e) {
      console.error(`There was an error fetching a resource: ${this.message}. No additional information available.`);
    }
    /* eslint-enable no-console */

    this.additional = additional;
  }
}

export class Builder {
  constructor(method, url) {
    this.request = request(method, url.replace(/([^:])\/\//, '$1/')).set('X-Requested-With', 'XMLHttpRequest');
  }

  authenticated() {
    const SessionStore = StoreProvider.getStore('Session');
    const token = SessionStore.getSessionId();

    return this.session(token);
  }

  session(sessionId) {
    this.request = this.request.auth(sessionId, 'session');

    return this;
  }

  setHeader(header, value) {
    this.request = this.request.set(header, value);

    return this;
  }

  json(body) {
    this.request = this.request
      .send(body)
      .type('json')
      .accept('json')
      .then((resp) => {
        if (resp.ok) {
          ServerAvailabilityActions.reportSuccess();
          return resp.body;
        }

        throw new FetchError(resp.statusText, resp);
      }, (error) => {
        const SessionStore = StoreProvider.getStore('Session');
        if (SessionStore.isLoggedIn() && error.status === 401) {
          SessionActions.logout(SessionStore.getSessionId());
        }

        // Redirect to the start page if a user is logged in but not allowed to access a certain HTTP API.
        if (SessionStore.isLoggedIn() && error.status === 403) {
          history.replaceState(null, Routes.STARTPAGE);
        }

        if (error.originalError && !error.originalError.status) {
          ServerAvailabilityActions.reportError(error);
        }

        throw new FetchError(error.statusText, error);
      });

    return this;
  }

  build() {
    return this.request;
  }
}

export default function fetch(method, url, body) {
  const promise = () => new Builder(method, url)
    .authenticated()
    .json(body)
    .build();

  const SessionStore = StoreProvider.getStore('Session');

  if (!SessionStore.isLoggedIn()) {
    return new Promise((resolve, reject) => {
      SessionActions.login.completed.listen(() => {
        promise().then(resolve, reject);
      });
    });
  }
  return promise();
}
