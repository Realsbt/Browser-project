(function () {
  const fire = () => window.dispatchEvent(new Event('ai-toc:urlchange'));
  const _push = history.pushState;
  history.pushState = function () { _push.apply(this, arguments); fire(); };
  const _rep = history.replaceState;
  history.replaceState = function () { _rep.apply(this, arguments); fire(); };
})();
