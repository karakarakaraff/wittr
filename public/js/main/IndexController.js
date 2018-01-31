import PostsView from './views/Posts';
import ToastsView from './views/Toasts';
import idb from 'idb';

function openDatabase() {
  // If the browser doesn't support service worker, we don't care about having a database
  if (!navigator.serviceWorker) {
    return Promise.resolve();
  }

  // Create the database store for posts. They will be keyed by their post ID, and they can be indexed by the time they were created.
  return idb.open('wittr', 1, function(upgradeDb) {
    var store = upgradeDb.createObjectStore('wittrs', {
      keyPath: 'id'
    });
    store.createIndex('by-date', 'time');
  });
}

export default function IndexController(container) {
  this._container = container;
  this._postsView = new PostsView(this._container);
  this._toastsView = new ToastsView(this._container);
  this._lostConnectionToast = null;
  this._dbPromise = openDatabase();
  this._registerServiceWorker();
  this._cleanImageCache();

  var indexController = this;

  // Clean the image cache every five minutes
  setInterval(function() {
    indexController._cleanImageCache();
  }, 1000 * 60 * 5);

  // After showing the cached posts, and only after, open a websocket to get any new posts that have not yet been cached.
  this._showCachedMessages().then(function() {
    indexController._openSocket();
  });
}

// Register the service worker
IndexController.prototype._registerServiceWorker = function() {
  // if the browser doesn't support service workers, do a simple return
  if (!navigator.serviceWorker) return;

  var indexController = this;

  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    if (!navigator.serviceWorker.controller) {
      return;
    }

    // Track the state of the service worker. If it's waiting, let the user know there's an update and they should refresh.
    if (reg.waiting) {
      indexController._updateReady(reg.waiting);
      return;
    }

    // Track the state of the service worker. If it's installing, track if the install succeeds. If it succeeds, alert the user to the update.
    if (reg.installing) {
      indexController._trackInstalling(reg.installing);
      return;
    }

    // Listen for an update, and if there is one, track if the install succeeds. If it succeeds, alert the user to the update.
    reg.addEventListener('updatefound', function() {
      indexController._trackInstalling(reg.installing);
    });
  });

  // Ensure refresh is only called once.
  // This works around a bug in "force update on reload".
  var refreshing;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (refreshing) return;
    window.location.reload();
    refreshing = true;
  });
};

IndexController.prototype._showCachedMessages = function() {
  var indexController = this;

  return this._dbPromise.then(function(db) {
    // if we're already showing posts, eg shift-refresh
    // or the very first load, there's no point fetching
    // posts from IDB
    if (!db || indexController._postsView.showingPosts()) return;

    // Query the database for all of the posts in order of the time they were created (will put them in order of oldest to newest).
    var index = db.transaction('wittrs')
      .objectStore('wittrs').index('by-date');

    // Return all of the posts, but reverse the index so they show from newest to oldest.
    return index.getAll().then(function(messages) {
      indexController._postsView.addPosts(messages.reverse());
    });
  });
};

// This is where we track the instalation of a new service worker and alert the user if the instalation succeeds.
IndexController.prototype._trackInstalling = function(worker) {
  var indexController = this;
  worker.addEventListener('statechange', function() {
    if (worker.state == 'installed') {
      indexController._updateReady(worker);
    }
  });
};

// This builds the little pop-up notification that alerts the user to an update. If the user chooses to update, we'll throw away the old service worker so the new service worker can skip waiting and immediately take control.
IndexController.prototype._updateReady = function(worker) {
  var toast = this._toastsView.show("New version available", {
    buttons: ['refresh', 'dismiss']
  });

  toast.answer.then(function(answer) {
    if (answer != 'refresh') return;
    worker.postMessage({action: 'skipWaiting'});
  });
};

// open a connection to the server for live updates
IndexController.prototype._openSocket = function() {
  var indexController = this;
  var latestPostDate = this._postsView.getLatestPostDate();

  // create a url pointing to /updates with the ws protocol
  var socketUrl = new URL('/updates', window.location);
  socketUrl.protocol = 'ws';

  if (latestPostDate) {
    socketUrl.search = 'since=' + latestPostDate.valueOf();
  }

  // this is a little hack for the settings page's tests,
  // it isn't needed for Wittr
  socketUrl.search += '&' + location.search.slice(1);

  var ws = new WebSocket(socketUrl.href);

  // add listeners
  ws.addEventListener('open', function() {
    if (indexController._lostConnectionToast) {
      indexController._lostConnectionToast.hide();
    }
  });

  ws.addEventListener('message', function(event) {
    requestAnimationFrame(function() {
      indexController._onSocketMessage(event.data);
    });
  });

  ws.addEventListener('close', function() {
    // tell the user
    if (!indexController._lostConnectionToast) {
      indexController._lostConnectionToast = indexController._toastsView.show("Unable to connect. Retrying…");
    }

    // try and reconnect in 5 seconds
    setTimeout(function() {
      indexController._openSocket();
    }, 5000);
  });
};

// Keep the image cache clean. Go to the database and get all of the JSON URL strings for photos and avatars connected to each message, then save those in the imagesNeeded array. After that, go to the cache and compare the URLs. If a URL in the cache is NOT included in the imagesNeeded array, delete it.
IndexController.prototype._cleanImageCache = function() {
  return this._dbPromise.then(function(db) {
    if (!db) return;

    var imagesNeeded = [];

    var tx = db.transaction('wittrs');
    return tx.objectStore('wittrs').getAll().then(function(messages) {
      messages.forEach(function(message) {
        if (message.photo) {
          imagesNeeded.push(message.photo);
        }
        imagesNeeded.push(message.avatar);
      });

      return caches.open('wittr-content-imgs');
    }).then(function(cache) {
      return cache.keys().then(function(requests) {
        requests.forEach(function(request) {
          var url = new URL(request.url);
          if (!imagesNeeded.includes(url.pathname)) cache.delete(request);
        });
      });
    });
  });
};

// called when the web socket sends message data
// Keep the database clean by only keeping the most recent 30 posts from the wittrs store and deleting the rest.
IndexController.prototype._onSocketMessage = function(data) {
  var messages = JSON.parse(data);

  this._dbPromise.then(function(db) {
    if (!db) return;

    var tx = db.transaction('wittrs', 'readwrite');
    var store = tx.objectStore('wittrs');
    messages.forEach(function(message) {
      store.put(message);
    });

    // limit store to 30 items
    store.index('by-date').openCursor(null, "prev").then(function(cursor) {
      return cursor.advance(30);
    }).then(function deleteRest(cursor) {
      if (!cursor) return;
      cursor.delete();
      return cursor.continue().then(deleteRest);
    });
  });

  this._postsView.addPosts(messages);
};
