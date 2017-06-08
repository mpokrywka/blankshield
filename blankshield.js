;(function(window) {
  'use strict';

  /**
   * Cached window.open function.
   *
   * @var {function}
   */
  var open = window.open;

  /**
   * blankshield is the main function exported by the library. It accepts an
   * anchor element or array of elements, adding an event listener to each to
   * help mitigate a potential reverse tabnabbing attack. For performance, any
   * supplied object with a length attribute is assumed to be an array.
   *
   * @param {HTMLAnchorElement|HTMLAnchorElement[]} target
   */
  function blankshield(target) {
    if (typeof target.length === 'undefined') {
      addEventListener(target, 'click', clickListener);
    } else if (typeof target !== 'string' && !(target instanceof String)) {
      for (var i = 0; i < target.length; i++) {
        addEventListener(target[i], 'click', clickListener);
      }
    }
  }

  var browser = blankshield.browser = {},
      navigator = window.navigator || {},
      userAgent = navigator.userAgent || '',
      document = window.document;

  // browser engine detection by testing features
  // noopener feature "detection" by detecting other engine features implemented simultaneously
  if (window.chrome && (chrome.webstore || chrome.csi)) {
    // Chrome 1+
    browser.chrome = true;

  } else if (/constructor/i.test(window.HTMLElement) ||
    Object.prototype.toString.call(window.safari && safari.pushNotification) == '[object SafariRemoteNotification]') {
    // Safari 3.0-9.1.2 "[object HTMLElementConstructor]"
    // SafariRemoteNotification added in Safari 7.1
    browser.safari = true;

  } else if (typeof InstallTrigger !== 'undefined') {
    // Firefox 1.0+
    browser.firefox = true;
    // https://developer.mozilla.org/en-US/Firefox/Releases/52
    // Event.composed property added and Event.cancelBubble property removed
    // when noopener was introduced
    browser.noopener = !!window.Event && 'composed' in Event.prototype &&
      !!window.UIEvent && !UIEvent.prototype.hasOwnProperty('cancelBubble');

  } else if ('ActiveXObject' in window) {
    // Internet Explorer 6-11
    // window.ActiveXObject is false in IE11, but 'ActiveXObject' in window
    // still returns true
    browser.msie = {
      // IEMobile detection by userAgent sniffing
      // TODO: check windows developer blog if feature detection is possible
      // https://blogs.windows.com/buildingapps/2012/11/08/internet-explorer-10-brings-html5-to-windows-phone-8-in-a-big-way
      mobile: /IEMobile/.test(userAgent)
    };

  } else if (window.StyleMedia) {
    // MS Edge
    // StyleMedia is also exposed in MSIE 9-11, but old IE is detected by
    // previous "if" condition
    browser.edge = true;

  } else if (window.opr && opr.addons) {
    // Opera 20+
    browser.opera = true;

  } else if (/ Chrome\/[1-9]/.test(userAgent)) {
    // Opera 15-19 && SamsungBrowser will be detected as Chrome-like by userAgent sniffing
    // Edge which also has "Chrome" string in userAgent was detected earlier
    browser.like_chrome = true;

  } else if (window.opera) {
    // Opera until 12.16 (Presto engine)
    browser.old_opera = true;

  } else if ('WebkitAppearance' in document.documentElement.style) {
    browser.webkit = true;
  }

  // Blink & Webkit noopener "detection"
  // assumption: less popular browsers include same features as primary engine users (Chrome/Safari)
  if (browser.chrome || browser.opera || browser.like_chrome) {
    // https://blog.chromium.org/2016/02/chrome-49-beta-css-custom-properties.html
    // navigator.getStorageUpdates and MouseEvent.webkitMovementX was removed
    // and OfflineAudioContext.suspend was added
    // when noopener was implemented
    browser.noopener = !navigator.getStorageUpdates &&
      !!window.MouseEvent && !('webkitMovementX' in MouseEvent.prototype) &&
      !!window.OfflineAudioContext && 'suspend' in OfflineAudioContext.prototype;

  } else if (browser.safari || browser.webkit) {
    // https://webkit.org/blog/7071/release-notes-for-safari-technology-preview-17/
    browser.noopener = !!window.InputEvent && 'dataTransfer' in InputEvent.prototype &&
      !!window.IDBIndex && 'getAll' in IDBIndex.prototype;
  }

  /**
   * Accepts the same arguments as window.open. If the strWindowName is not
   * equal to one of the safe targets (_top, _self or _parent), then:
   * - for Safari it opens the destination url using "window.open" from
   *   an injected iframe, then removes the iframe. This method cannot be used
   *   in other browsers because it also clears referrer,
   * - for old MSIE - it opens blank window, sets child window's opener to null
   *   and then sets requested location, in IEMobile "window.open" replaces
   *   current window and doesn't return valid window object, so this method
   *   cannot be used,
   * - for other browsers - it uses "window.open" followed by setting the child
   *   window's opener to null.
   * If the strWindowName is set to some other value, the url is simply
   * opened with window.open().
   *
   * @param   {string} strUrl
   * @param   {string} [strWindowName]
   * @param   {string} [strWindowFeatures]
   * @returns {Window}
   */
  blankshield.open = function(strUrl, strWindowName, strWindowFeatures) {
    var child, args;

    if (safeTarget(strWindowName)) {
      return open.apply(window, arguments);
    } else if (browser.safari) {
      return iframeOpen(strUrl, strWindowName, strWindowFeatures);
    } else if (browser.msie && !browser.msie.mobile) {
      args = Array.prototype.slice.call(arguments);
      args[0] = '';
      child = open.apply(window, args);
      if (child) {
        child.opener = null;
        child.location = strUrl;
      }
      return child;
    } else {
      child = open.apply(window, arguments);
      if (child) {
        child.opener = null;
      }
      return child;
    }
  };

  /**
   * Patches window.open() to use blankshield.open() for new window/tab targets.
   */
  blankshield.patch = function() {
    window.open = function() {
      return blankshield.open.apply(this, arguments);
    };
  };

  /**
   * An event listener that can be attached to a click event to protect against
   * reverse tabnabbing. It retrieves the target anchors href, and if the link
   * was intended to open in a new tab or window, the browser's default
   * behavior is canceled. Instead, the destination url is opened using
   * "window.open" from an injected iframe, and the iframe is removed. Except
   * for IE < 11, which uses "window.open" followed by setting the child
   * window's opener to null.
   *
   * @param {Event} e The click event for a given anchor
   */
  function clickListener(e) {
    var target, targetName, href, usedModifier;

    // Use global event object for IE8 and below to get target
    e = e || window.event;
    // Won't work for IE8 and below for cases when e.srcElement
    // refers not to the anchor, but to the element inside it e.g. an image
    target = e.currentTarget || e.srcElement;

    // Ignore anchors without an href
    href = target.getAttribute('href');
    if (!href) return;

    // Ignore anchors without an unsafe target or modifier key
    usedModifier = (e.ctrlKey || e.shiftKey || e.metaKey);
    targetName = target.getAttribute('target');
    if (!usedModifier && (!targetName || safeTarget(targetName))) {
      return;
    }

    blankshield.open(href);

    // IE8 and below don't support preventDefault
    if (e.preventDefault) {
      e.preventDefault();
    } else {
      e.returnValue = false;
    }

    return false;
  }

  /**
   * A cross-browser addEventListener function that adds a listener for the
   * supplied event type to the specified target.
   *
   * @param {object}   target
   * @param {string}   type
   * @param {function} listener
   */
  function addEventListener(target, type, listener) {
    var onType, prevListener;

    // Modern browsers
    if (target.addEventListener) {
      return target.addEventListener(type, listener, false);
    }

    // Older browsers
    onType = 'on' + type;
    if (target.attachEvent) {
      target.attachEvent(onType, listener);
    } else if (target[onType]) {
      prevListener = target[onType];
      target[onType] = function() {
        listener();
        prevListener();
      };
    } else {
      target[onType] = listener;
    }
  }

  /**
   * Opens the provided url by injecting a hidden iframe that calls
   * window.open(), then removes the iframe from the DOM.
   *
   * @param   {string} url The url to open
   * @param   {string} [strWindowName]
   * @param   {string} [strWindowFeatures]
   * @returns {Window}
   */
  function iframeOpen(url, strWindowName, strWindowFeatures) {
    var iframe, iframeDoc, script, openArgs, newWin;

    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

    openArgs = '"' + url + '"';
    if (strWindowName) {
      openArgs += ', "' + strWindowName + '"';
    } else {
      openArgs += ', null';
    }

    if (strWindowFeatures) {
      openArgs += ', "' + strWindowFeatures + '"';
    }

    script = iframeDoc.createElement('script');
    script.type = 'text/javascript';
    script.text = 'window.parent = null; window.top = null;' +
      'window.frameElement = null; var child = window.open(' + openArgs + ');' +
      'child.opener = null';
    iframeDoc.body.appendChild(script);
    newWin = iframe.contentWindow.child;

    document.body.removeChild(iframe);
    return newWin;
  }

  /**
   * Returns whether or not the given target is safe.
   *
   * @param  {string}  target
   * @return {boolean}
   */
  function safeTarget(target) {
    return target === '_top' || target === '_self' || target === '_parent';
  }

  /**
   * Export for various environments.
   */

  // Export CommonJS
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = blankshield;
    } else {
      exports.blankshield = blankshield;
    }
  }

  // Register with AMD
  if (typeof define == 'function' && typeof define.amd == 'object') {
    define('blankshield', [], function() {
      return blankshield;
    });
  }

  // export default blankshield function
  window.blankshield = blankshield;
})(window);
