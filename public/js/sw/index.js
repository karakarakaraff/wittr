// variable to hold the cache for the static content
var staticCacheName = 'wittr-static-v8';

// variable to hold the cache for the images
var contentImgsCache = 'wittr-content-imgs';

// keep track of all the caches
var allCaches = [
  staticCacheName,
  contentImgsCache
];

// When a browser runs this service worker for the first time, it will trigger this install event. The browser won’t let the service worker take over until the install event is completed. This section of code will fetch everything from the network, create a cache, and add all the assets to that cache.
// This particular install event is only creating and adding to the static cache. Images/avatars are NOT included. They have their own cache (wittr-content-imgs).
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(staticCacheName).then(function(cache) {
      return cache.addAll([
        '/skeleton',
        'js/main.js',
        'css/main.css',
        'imgs/icon.png',
        'https://fonts.gstatic.com/s/roboto/v15/2UX7WLTfW3W8TclTUvlFyQ.woff',
        'https://fonts.gstatic.com/s/roboto/v15/d-6IYplOFocCacKzxwXSOD8E0i7KZn-EPnyo3HZu7kw.woff'
      ]);
    })
  );
});

// When a previously waiting service worker becomes active, it will trigger this activate event. This section of code will go through all the caches currently saved in the browser and delete the old ones.
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          return cacheName.startsWith('wittr-') &&
                 !allCaches.includes(cacheName);
        }).map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// Fetch assets from a cache
self.addEventListener('fetch', function(event) {
  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin === location.origin) {
    if (requestUrl.pathname === '/') {
      // fetch the cache the page skeleton
      event.respondWith(caches.match('/skeleton'));
      return;
    }
    if (requestUrl.pathname.startsWith('/photos/')) {
      // fetch the cached photos
      event.respondWith(servePhoto(event.request));
      return;
    }
    if (requestUrl.pathname.startsWith('/avatars/')) {
      // fetch the cached avatars
      event.respondWith(serveAvatar(event.request));
      return;
    }
  }
  // If the request to the cache goes through, return the asset from the cache if it's there, OR fetch it from the network.
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

function serveAvatar(request) {
  // Grab the image URL from the content in the database but without the size/format specifications
  var storageUrl = request.url.replace(/-\dx\.jpg$/, '');

  // Return the avatars from the wittr-content-imgs cache if they're in there. But afterward, go the network and update each avatar in the cache -- this will catch if a user changed their avatar.
  return caches.open(contentImgsCache).then(function(cache) {
    return cache.match(storageUrl).then(function(response) {
      var networkFetch = fetch(request).then(function(networkResponse) {
        cache.put(storageUrl, networkResponse.clone());
        return networkResponse;
      });
      return response || networkFetch;
    });
  });
}

function servePhoto(request) {
  // Grab the image URL from the content in the database but without the size/format specifications
  var storageUrl = request.url.replace(/-\d+px\.jpg$/, '');

  // Return the photos from the wittr-content-imgs cache if they're in there. If not, fetch them from the network, put them in the cache, and then send them to the browser.
  return caches.open(contentImgsCache).then(function(cache) {
    return cache.match(storageUrl).then(function(response) {
      if (response) return response;

      return fetch(request).then(function(networkResponse) {
        cache.put(storageUrl, networkResponse.clone());
        return networkResponse;
      });
    });
  });
}

// The updated service worker should NOT wait behind any other service worker — it should take over the moment it’s done installing
self.addEventListener('message', function(event) {
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
