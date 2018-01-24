self.addEventListener('fetch', function(event) {
	// TODO: respond to all requests with an html response
	// containing an element with class="a-winner-is-me".
	// Ensure the Content-Type of the response is "text/html"
  event.respondWith(
    new Response("<p>Hello, world!</p><p class='a-winner-is-me'>Just FYI, I'm a winner!</p>", {
      headers: {'content-type': 'text/html'}
    })
  );
});
