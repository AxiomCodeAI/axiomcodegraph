#!/bin/bash
# Pulls the HTML/CSS corpora the bench runs over into ./corpus (git-ignored). ~500MB, a few minutes.
set -e
cd "$(dirname "$0")"; mkdir -p corpus live/html live/css; cd corpus
clone() { [ -d "$2" ] || git clone -q --depth 1 "https://github.com/$1.git" "$2"; }
clone csstree/csstree csstree                      # css-tree AST fixtures (selector/at-rule/declaration edge cases)
clone postcss/postcss-parser-tests postcss-parser-tests
clone mdn/dom-examples dom-examples                # small real-world pages
clone h5bp/html5-boilerplate html5-boilerplate
clone spring-projects/spring-petclinic spring-petclinic   # Thymeleaf templates
clone twbs/bootstrap bootstrap                     # dist css incl. minified
clone angular/components components                # Angular templates, component css
clone django/django django                         # Django templates, admin css
clone inikulin/parse5 parse5                       # huge-page, location-info pages
( cd parse5 && git config submodule.html5lib-tests.url https://github.com/html5lib/html5lib-tests.git \
  && git submodule update --init --depth 1 test/data/html5lib-tests )   # html5lib tree-construction .dat
if [ ! -d wpt ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/web-platform-tests/wpt.git wpt
  ( cd wpt && git sparse-checkout set html/syntax css/css-syntax css/selectors css/css-nesting css/css-variables css/css-cascade \
      html/semantics/scripting-1 html/semantics/embedded-content css/css-fonts css/css-animations css/css-images )
fi
mkdir -p live/html live/css; cd live
f() { [ -s "$2" ] || curl -sL --max-time 40 -A "Mozilla/5.0" -o "$2" "$1" || true; }
f https://html.spec.whatwg.org/ html/whatwg-html-spec.html; f https://en.wikipedia.org/wiki/HTML html/wikipedia-html.html
f https://github.com/ html/github.html; f https://developer.mozilla.org/en-US/docs/Web/HTML html/mdn-html.html
f https://www.bbc.com/ html/bbc.html; f https://www.apple.com/ html/apple.html; f https://www.cnn.com/ html/cnn.html
f https://getbootstrap.com/docs/5.3/components/navbar/ html/bootstrap-docs.html; f https://tailwindcss.com/ html/tailwind.html
f https://news.ycombinator.com/ html/hn.html; f https://react.dev/ html/react.html; f https://www.theguardian.com/international html/guardian.html
f https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css css/bootstrap.min.css
f https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css css/tailwind-2.min.css
f https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.css css/fontawesome.css
f https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.css css/bulma.css; f https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css css/animate.min.css
f https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.css css/pico.css; f https://cdn.jsdelivr.net/npm/open-props@1.7.4/open-props.min.css css/open-props.min.css
f https://cdn.jsdelivr.net/npm/semantic-ui@2.5.0/dist/semantic.css css/semantic.css; f https://cdn.jsdelivr.net/npm/materialize-css@1.0.0/dist/css/materialize.css css/materialize.css
echo "corpora ready"
