# The release channel of nyx-monitor: static files only, built by release.sh into
# site/ and published at nyx.majomaken.dev.
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
