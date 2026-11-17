# Context-menu read retry

Screen actions, request options and list memberships retry a transient read once after 250 ms. They share the in-flight read, preserve cancellation on close or scope replacement, and publish the final failure to the existing toast system. The request dialog retains its existing read policy. Mutation submission and playback and sharing actions keep their existing paths.

The menu resource, request controls, request dialog lifetime, request options cancellation, menu lifecycle, work menu scope and UI feedback tests passed locally. The original hosted observations and acceptance scope remain in their recorded epoch.
