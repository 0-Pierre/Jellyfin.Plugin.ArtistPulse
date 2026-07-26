(function () {
    'use strict';

    if (window.ArtistInsightsHandler) {
        return;
    }

    var handler = {
        currentArtistId: null,
        currentData: null,
        requestInFlight: false,
        renderTimer: null,
        renderRetryTimer: null,
        renderRetryAttempts: 0,
        resizeTimer: null,
        activeSongId: null,
        initialTopSongs: 12,
        topSongsIncrement: 12,
        webpackRequire: null,
        webpackPlaybackManager: null,

        init: function () {
            window.addEventListener('hashchange', handler.schedule);
            window.addEventListener('popstate', handler.schedule);
            window.addEventListener('resize', handler.scheduleTopSongsLayout);

            var observer = new MutationObserver(handler.schedule);
            observer.observe(document.body, { childList: true, subtree: true });
            handler.bindPlaybackState();
            window.setInterval(handler.updatePlaybackButtons, 1000);
            handler.schedule();
        },

        schedule: function () {
            window.clearTimeout(handler.renderTimer);
            handler.renderTimer = window.setTimeout(handler.process, 90);
        },

        process: function () {
            var artistId = handler.getArtistId();
            if (!artistId) {
                handler.cancelRenderRetry();
                handler.currentArtistId = null;
                handler.currentData = null;
                return;
            }

            if (handler.currentArtistId !== artistId) {
                handler.cancelRenderRetry();
            }

            if (handler.currentArtistId === artistId && handler.currentData) {
                if (handler.needsRender(handler.currentData)) {
                    handler.render(handler.currentData);
                }
                return;
            }

            if (handler.requestInFlight) {
                return;
            }

            // This script is injected into index.html and can run before the
            // Jellyfin Web API client has completed its own startup. Do not
            // mark a request as in flight until the client is genuinely ready,
            // otherwise the initial artist page would never retry.
            if (!window.ApiClient || typeof window.ApiClient.ajax !== 'function' || typeof window.ApiClient.getUrl !== 'function') {
                window.setTimeout(handler.process, 250);
                return;
            }

            handler.requestInFlight = true;
            handler.currentArtistId = artistId;
            handler.currentData = null;
            try {
                Promise.resolve(window.ApiClient.ajax({
                    url: window.ApiClient.getUrl('ArtistInsights/artist/' + encodeURIComponent(artistId)),
                    type: 'GET',
                    dataType: 'json'
                })).then(function (data) {
                    handler.currentArtistId = artistId;
                    handler.currentData = handler.normaliseResponse(data);
                    handler.renderRetryAttempts = 0;
                    handler.render(handler.currentData);
                }).catch(function () {
                    // The endpoint returns 404 for any non-artist detail page. This is expected.
                    handler.currentData = null;
                }).finally(function () {
                    handler.requestInFlight = false;
                });
            } catch (error) {
                // A synchronous startup error must also release the lock so a
                // later DOM/router event can start the request normally.
                handler.requestInFlight = false;
                window.setTimeout(handler.process, 250);
            }
        },

        getArtistId: function () {
            var hash = window.location.hash || '';
            if (hash.indexOf('details') === -1) {
                return null;
            }

            var queryIndex = hash.indexOf('?');
            if (queryIndex === -1) {
                return null;
            }

            var id = new URLSearchParams(hash.substring(queryIndex + 1)).get('id');
            // Jellyfin Web uses both compact (32-character) and hyphenated GUID item ids depending on client/version.
            return id && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id) ? id : null;
        },

        // Jellyfin server JSON currently preserves .NET PascalCase property
        // names, while some web clients use camelCase. Normalise at this
        // boundary so the view is independent of that serializer setting.
        normaliseResponse: function (response) {
            var property = function (value, name) {
                if (!value) {
                    return undefined;
                }
                if (Object.prototype.hasOwnProperty.call(value, name)) {
                    return value[name];
                }
                return value[name.charAt(0).toUpperCase() + name.substring(1)];
            };
            var songs = property(response, 'topSongs') || [];
            var releases = property(response, 'singles') || [];

            return {
                topSongsSource: property(response, 'topSongsSource') || '',
                topSongs: songs.map(function (song) {
                    return {
                        itemId: property(song, 'itemId'),
                        name: property(song, 'name'),
                        album: property(song, 'album'),
                        imageItemId: property(song, 'imageItemId'),
                        runTimeTicks: property(song, 'runTimeTicks'),
                        listenCount: property(song, 'listenCount'),
                        isFavorite: property(song, 'isFavorite'),
                        canPlay: property(song, 'canPlay')
                    };
                }),
                albums: property(response, 'albums') || [],
                singles: releases.map(function (release) {
                    return {
                        id: property(release, 'id'),
                        name: property(release, 'name'),
                        year: property(release, 'year'),
                        trackCount: property(release, 'trackCount'),
                        imageItemId: property(release, 'imageItemId')
                    };
                })
            };
        },

        render: function (data) {
            var albumsSection = handler.sectionForTitle('Albums');
            if (!albumsSection) {
                // Artist pages are progressively populated by Jellyfin Web.
                // The data endpoint can win that race on a cold navigation, so
                // retry briefly instead of requiring a second browser refresh.
                handler.scheduleRenderRetry();
                return;
            }

            handler.cancelRenderRetry();
            // Jellyfin Web wraps the stock Albums section in an anonymous
            // element. Insert independent Artist Pulse sections beside it so
            // that its album-card background cannot wrap our new sections.
            var albumsContainer = handler.getArtistSectionContainer(albumsSection);
            handler.renderTopSongs(data, albumsContainer);
            handler.renderSingles(data, albumsSection, albumsContainer);
        },

        cancelRenderRetry: function () {
            window.clearTimeout(handler.renderRetryTimer);
            handler.renderRetryTimer = null;
            handler.renderRetryAttempts = 0;
        },

        scheduleRenderRetry: function () {
            if (handler.renderRetryTimer || handler.renderRetryAttempts >= 40) {
                return;
            }

            handler.renderRetryAttempts++;
            handler.renderRetryTimer = window.setTimeout(function () {
                handler.renderRetryTimer = null;
                if (handler.currentData && handler.currentArtistId === handler.getArtistId()) {
                    handler.render(handler.currentData);
                }
            }, 250);
        },

        needsRender: function (data) {
            if (!document.querySelector('.artistInsightsTopSongs')) {
                return true;
            }
            return !!(data.singles && data.singles.length && !document.querySelector('.artistInsightsSingles'));
        },

        renderTopSongs: function (data, albumsContainer) {
            var existing = document.querySelector('.artistInsightsTopSongs');
            if (existing) {
                existing.remove();
            }

            if (!data.topSongs || !data.topSongs.length) {
                return;
            }

            var section = document.createElement('div');
            section.className = 'artistInsightsTopSongs';
            section.setAttribute('data-artist-insights', 'top-songs');

            var heading = document.createElement('div');
            heading.className = 'artistInsightsHeading';
            heading.innerHTML = '<h2 class="sectionTitle">Top Songs <span class="material-icons artistInsightsHeadingIcon" aria-hidden="true">chevron_right</span></h2>';
            if (data.topSongsSource === 'listenbrainz') {
                heading.title = 'Ranked by ListenBrainz; only tracks available on this server are shown.';
            }
            section.appendChild(heading);

            var grid = document.createElement('div');
            grid.className = 'artistInsightsTrackGrid';
            data.topSongs.forEach(function (song, index) {
                var row = handler.createNativeTrackRow(song, index + 1, data.topSongsSource);
                if (index >= handler.initialTopSongs) {
                    row.classList.add('artistInsightsTrackHidden');
                    row.hidden = true;
                }
                grid.appendChild(row);
            });

            section.appendChild(grid);
            handler.updateTopSongsGridLayout(grid);
            if (data.topSongs.length > handler.initialTopSongs) {
                var controls = document.createElement('div');
                controls.className = 'artistInsightsTopSongControls';
                var showMore = document.createElement('button');
                // Reuse Jellyfin's own button component instead of a plain
                // browser button, so themes own its colour and focus style.
                showMore.className = 'raised button-alt emby-button artistInsightsShowMore';
                showMore.setAttribute('is', 'emby-button');
                showMore.type = 'button';
                showMore.addEventListener('click', function () {
                    var hiddenRows = Array.prototype.slice.call(grid.querySelectorAll('.artistInsightsTrackHidden'));
                    if (hiddenRows.length) {
                        hiddenRows.slice(0, handler.topSongsIncrement).forEach(function (row) {
                            row.hidden = false;
                            row.classList.remove('artistInsightsTrackHidden');
                        });
                    }
                    handler.updateTopSongsGridLayout(grid);
                    handler.updateTopSongsControls(showMore, showLess, grid);
                });
                var showLess = document.createElement('button');
                showLess.className = 'raised button-alt emby-button artistInsightsShowLess';
                showLess.setAttribute('is', 'emby-button');
                showLess.type = 'button';
                showLess.textContent = 'Show less';
                showLess.addEventListener('click', function () {
                    Array.prototype.slice.call(grid.querySelectorAll('.artistInsightsTrack')).slice(handler.initialTopSongs).forEach(function (row) {
                        row.hidden = true;
                        row.classList.add('artistInsightsTrackHidden');
                    });
                    handler.updateTopSongsGridLayout(grid);
                    handler.updateTopSongsControls(showMore, showLess, grid);
                });
                controls.appendChild(showMore);
                controls.appendChild(showLess);
                section.appendChild(controls);
                handler.updateTopSongsControls(showMore, showLess, grid);
            }
            albumsContainer.parentNode.insertBefore(section, albumsContainer);
        },

        updateTopSongsControls: function (showMore, showLess, grid) {
            var remaining = grid.querySelectorAll('.artistInsightsTrackHidden').length;
            var visible = grid.querySelectorAll('.artistInsightsTrack').length - remaining;
            showMore.hidden = remaining === 0;
            showLess.hidden = visible <= handler.initialTopSongs;
            showMore.textContent = 'Show more (' + remaining + ')';
        },

        scheduleTopSongsLayout: function () {
            window.clearTimeout(handler.resizeTimer);
            handler.resizeTimer = window.setTimeout(function () {
                document.querySelectorAll('.artistInsightsTrackGrid').forEach(handler.updateTopSongsGridLayout);
            }, 100);
        },

        updateTopSongsGridLayout: function (grid) {
            if (!grid) {
                return;
            }

            var columns = window.innerWidth <= 600 ? 1 : window.innerWidth <= 1000 ? 2 : 3;
            var visibleRows = Array.prototype.slice.call(grid.querySelectorAll('.artistInsightsTrack')).filter(function (row) {
                return !row.hidden;
            }).length;
            grid.style.setProperty('--artistInsightsTopSongsRows', String(Math.max(1, Math.ceil(visibleRows / columns))));
        },

        // The markup keeps Jellyfin's native icons and list classes, while
        // playback uses its public API client instead of a page-local handler.
        createNativeTrackRow: function (song, rank, source) {
            var playable = !!(song.itemId && song.canPlay);
            var row = document.createElement('div');
            row.className = 'artistInsightsTrack listItem';
            row.innerHTML =
                '<span class="artistInsightsRank" aria-label="Rank ' + rank + '">' + rank + '</span>' +
                '<span class="artistInsightsCover cardImageContainer" aria-hidden="true"><span class="cardImageIcon material-icons album artistInsightsCoverFallback"></span><span class="material-icons artistInsightsPlaybackState play_arrow" hidden></span></span>' +
                '<div class="artistInsightsTrackText"><span class="artistInsightsTrackName">' + handler.escapeHtml(song.name) + '</span><span class="artistInsightsAlbumName">' + handler.escapeHtml(song.album || '') + '</span></div>' +
                '<button is="paper-icon-button-light" class="paper-icon-button-light artistInsightsFavourite btnUserData" type="button" title="Favourite" aria-label="Favourite"><span class="material-icons favorite_border" aria-hidden="true"></span></button>' +
                '<button is="paper-icon-button-light" class="paper-icon-button-light artistInsightsMore" type="button" title="More" aria-label="More"><span class="material-icons more_vert" aria-hidden="true"></span></button>';

            var cover = row.querySelector('.artistInsightsCover');
            var favouriteButton = row.querySelector('.artistInsightsFavourite');
            var moreButton = row.querySelector('.artistInsightsMore');
            var image = song.imageItemId ? window.ApiClient.getUrl('Items/' + song.imageItemId + '/Images/Primary?fillHeight=64&fillWidth=64&quality=90') : '';

            if (image) {
                // A CSS background fails gracefully: the native icon remains
                // visible when an item has no primary image or it is missing.
                cover.style.backgroundImage = 'url("' + image + '")';
            }
            favouriteButton.disabled = !song.itemId;
            handler.setFavouriteState(favouriteButton, !!song.isFavorite);
            moreButton.disabled = !song.itemId;

            if (playable) {
                row.setAttribute('data-id', song.itemId);
                row.setAttribute('data-type', 'Audio');
                row.setAttribute('data-mediatype', 'Audio');
                row.setAttribute('data-isfolder', 'false');
                row.tabIndex = 0;
                var serverId = handler.getServerId();
                if (serverId) {
                    row.setAttribute('data-serverid', serverId);
                }
            }
            if (song.itemId) {
                favouriteButton.setAttribute('data-favourite-item', song.itemId);
            }
            row.addEventListener('click', function (event) {
                if (!playable || event.target.closest('.artistInsightsFavourite, .artistInsightsMore')) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                handler.playSong(song.itemId);
            });
            row.addEventListener('keydown', function (event) {
                if (playable && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handler.playSong(song.itemId);
                }
            });
            favouriteButton.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                handler.toggleNativeFavourite(favouriteButton);
            });
            moreButton.addEventListener('click', function (event) {
                if (!song.itemId) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                handler.openItem(song.itemId);
            });
            return row;
        },

        createTrackRow: function (song, rank, source) {
            var row = document.createElement('div');
            row.className = 'artistInsightsTrack';
            var image = song.imageItemId ? window.ApiClient.getUrl('Items/' + song.imageItemId + '/Images/Primary?fillHeight=64&fillWidth=64&quality=90') : '';
            var duration = handler.formatDuration(song.runTimeTicks);
            var countTitle = source === 'listenbrainz'
                ? handler.formatNumber(song.listenCount) + ' global ListenBrainz listens'
                : handler.formatNumber(song.listenCount) + ' Jellyfin plays';
            var playDisabled = song.canPlay ? '' : ' disabled';
            var favouriteState = song.isFavorite ? ' isFavourite' : '';

            row.innerHTML =
                '<span class="artistInsightsRank">' + rank + '</span>' +
                '<button class="artistInsightsCover" type="button"' + (song.itemId ? ' data-open-item="' + song.itemId + '"' : '') + '>' +
                    (image ? '<img src="' + image + '" alt="" loading="lazy" />' : '<span class="artistInsightsCoverFallback">♪</span>') +
                '</button>' +
                '<button class="artistInsightsTrackText" type="button"' + (song.itemId ? ' data-open-item="' + song.itemId + '"' : '') + '>' +
                    '<span class="artistInsightsTrackName">' + handler.escapeHtml(song.name) + '</span>' +
                    '<span class="artistInsightsAlbumName">' + handler.escapeHtml(song.album || '') + '</span>' +
                '</button>' +
                '<button class="artistInsightsIconButton artistInsightsFavourite' + favouriteState + '" type="button" title="Favourite"' + (song.itemId ? ' data-favourite-item="' + song.itemId + '" data-favourite="' + song.isFavorite + '"' : ' disabled') + '>♥</button>' +
                '<button class="artistInsightsIconButton" type="button" title="Play"' + playDisabled + (song.itemId ? ' data-play-item="' + song.itemId + '"' : '') + '>▶</button>' +
                '<span class="artistInsightsDuration" title="' + handler.escapeHtml(countTitle) + '">' + duration + '</span>' +
                '<button class="artistInsightsIconButton artistInsightsMore" type="button" title="Open item"' + (song.itemId ? ' data-open-item="' + song.itemId + '"' : ' disabled') + '>⋮</button>';

            row.querySelectorAll('[data-open-item]').forEach(function (button) {
                button.addEventListener('click', function () {
                    handler.openItem(button.getAttribute('data-open-item'));
                });
            });
            var playButton = row.querySelector('[data-play-item]');
            if (playButton) {
                playButton.addEventListener('click', function () {
                    handler.playItem(playButton.getAttribute('data-play-item'));
                });
            }
            var favouriteButton = row.querySelector('[data-favourite-item]');
            if (favouriteButton) {
                favouriteButton.addEventListener('click', function () {
                    handler.toggleFavourite(favouriteButton);
                });
            }
            return row;
        },

        renderSingles: function (data, albumsSection, albumsContainer) {
            document.querySelectorAll('.artistInsightsSingles').forEach(function (section) { section.remove(); });
            document.querySelectorAll('.artistInsightsHiddenAlbum').forEach(function (card) {
                card.classList.remove('artistInsightsHiddenAlbum');
            });

            if (!data.singles || !data.singles.length) {
                return;
            }

            var singleIds = {};
            data.singles.forEach(function (release) { singleIds[release.id.toLowerCase()] = true; });
            handler.hideNativeSingleCards(albumsSection, singleIds);

            var section = document.createElement('div');
            section.className = 'artistInsightsSingles';
            section.setAttribute('data-artist-insights', 'singles');
            section.innerHTML = '<div class="artistInsightsHeading"><h2 class="sectionTitle">Singles</h2></div>';

            var releases = document.createElement('div');
            // Keep the markup native so every Jellyfin theme controls card
            // size, spacing, colours, focus rings and hover behaviour.
            releases.className = 'itemsContainer vertical-wrap';
            data.singles.forEach(function (release) {
                releases.appendChild(handler.createNativeReleaseCard(release));
            });
            section.appendChild(releases);
            albumsContainer.parentNode.insertBefore(section, albumsContainer.nextSibling);
        },

        hideNativeSingleCards: function (albumsSection, singleIds) {
            albumsSection.querySelectorAll('a[href*="id="]').forEach(function (anchor) {
                var id = handler.getItemIdFromHref(anchor.getAttribute('href'));
                if (!id || !singleIds[id.toLowerCase()]) {
                    return;
                }

                var card = anchor.closest('.card');
                if (card) {
                    card.classList.add('artistInsightsHiddenAlbum');
                }
            });
        },

        sectionForTitle: function (title) {
            var titles = Array.prototype.slice.call(document.querySelectorAll('.sectionTitle, h1, h2, h3'));
            var heading = titles.find(function (element) {
                return !element.closest('[data-artist-insights]') && element.textContent.trim().toLowerCase() === title.toLowerCase();
            });
            if (!heading) {
                return null;
            }

            return heading.closest('.verticalSection') || heading.parentElement;
        },

        getArtistSectionContainer: function (section) {
            var parent = section && section.parentElement;
            // The stock artist page uses this unclassified parent as an album
            // card wrapper. Artist Pulse must be its sibling, not its child.
            return parent && !parent.className && parent.parentElement ? parent : section;
        },

        getItemIdFromHref: function (href) {
            if (!href) {
                return null;
            }
            var match = href.match(/[?&]id=([0-9a-f]{32}|[0-9a-f-]{36})/i);
            return match ? match[1] : null;
        },

        createNativeReleaseCard: function (release) {
            var serverId = handler.getServerId();
            var card = document.createElement('div');
            card.className = 'card overflowSquareCard card-hoverable';
            card.setAttribute('data-id', release.id);
            card.setAttribute('data-type', 'MusicAlbum');
            card.setAttribute('data-mediatype', 'Audio');
            card.setAttribute('data-isfolder', 'true');
            if (serverId) {
                card.setAttribute('data-serverid', serverId);
            }

            var box = document.createElement('div');
            box.className = 'cardBox cardBox-bottompadded';
            var scalable = document.createElement('div');
            scalable.className = 'cardScalable';
            var padder = document.createElement('div');
            padder.className = 'cardPadder cardPadder-overflowSquare';
            padder.innerHTML = '<span class="cardImageIcon material-icons album" aria-hidden="true"></span>';
            var imageLink = document.createElement('a');
            imageLink.className = 'cardImageContainer coveredImage cardContent itemAction';
            imageLink.href = '#/details?id=' + release.id;
            imageLink.setAttribute('data-action', 'link');
            imageLink.setAttribute('data-id', release.id);
            imageLink.setAttribute('data-type', 'MusicAlbum');
            imageLink.setAttribute('data-mediatype', 'Audio');
            imageLink.setAttribute('data-isfolder', 'true');
            imageLink.setAttribute('aria-label', release.name || 'Album');
            if (serverId) {
                imageLink.setAttribute('data-serverid', serverId);
            }
            if (release.imageItemId) {
                imageLink.style.backgroundImage = 'url("' + window.ApiClient.getUrl('Items/' + release.imageItemId + '/Images/Primary?fillHeight=300&fillWidth=300&quality=90') + '")';
            }

            var footer = document.createElement('div');
            footer.className = 'cardFooter cardFooter-transparent';
            footer.innerHTML =
                '<div class="cardText cardTextCentered cardText-first">' + handler.escapeHtml(release.name) + '</div>' +
                '<div class="cardText cardTextCentered cardText-secondary">' + (release.year || '') + '</div>';
            scalable.appendChild(padder);
            scalable.appendChild(imageLink);
            box.appendChild(scalable);
            box.appendChild(footer);
            card.appendChild(box);
            return card;
        },

        getServerId: function () {
            if (!window.ApiClient || typeof window.ApiClient.serverInfo !== 'function') {
                return null;
            }
            var server = window.ApiClient.serverInfo();
            return server && (server.Id || server.id) ? (server.Id || server.id) : null;
        },

        bindPlaybackState: function () {
            ['play', 'pause', 'ended', 'emptied'].forEach(function (eventName) {
                document.addEventListener(eventName, function () {
                    window.setTimeout(handler.updatePlaybackButtons, 0);
                }, true);
            });
        },

        getPlaybackElement: function () {
            return document.querySelector('audio, video');
        },

        getPlaybackManager: function () {
            var globalManager = window.PlaybackManager || window.playbackManager ||
                (window.Emby && window.Emby.PlaybackManager);
            if (globalManager) {
                return globalManager;
            }

            if (handler.webpackPlaybackManager) {
                return handler.webpackPlaybackManager;
            }

            // Jellyfin Web 10.11 keeps the singleton playback manager inside
            // its Webpack module graph, not on window. Capture its runtime
            // require function and select only the module whose factory has
            // the manager's distinctive public methods. This is deliberately
            // defensive so unsupported Web clients simply retain normal UI.
            var webpackRequire = handler.getWebpackRequire();
            if (!webpackRequire || !webpackRequire.m) {
                return null;
            }

            try {
                var moduleIds = Object.keys(webpackRequire.m);
                for (var index = 0; index < moduleIds.length; index++) {
                    var moduleId = moduleIds[index];
                    var factoryText = String(webpackRequire.m[moduleId]);
                    if (factoryText.indexOf('getItemsForPlayback') === -1 || factoryText.indexOf('playPause') === -1) {
                        continue;
                    }

                    var moduleExports = webpackRequire(moduleId);
                    var exportKeys = Object.keys(moduleExports || {});
                    for (var exportIndex = 0; exportIndex < exportKeys.length; exportIndex++) {
                        var candidate = moduleExports[exportKeys[exportIndex]];
                        if (candidate && typeof candidate.play === 'function' &&
                            typeof candidate.playPause === 'function' && typeof candidate.currentItem === 'function') {
                            handler.webpackPlaybackManager = candidate;
                            return candidate;
                        }
                    }
                }
            } catch (error) {
                console.debug('[Artist Pulse] Native playback manager lookup was unavailable.', error);
            }

            return null;
        },

        getWebpackRequire: function () {
            if (handler.webpackRequire) {
                return handler.webpackRequire;
            }

            if (!window.webpackChunk || typeof window.webpackChunk.push !== 'function') {
                return null;
            }

            try {
                var capturedRequire = null;
                window.webpackChunk.push([[Date.now()], {}, function (webpackRequire) {
                    capturedRequire = webpackRequire;
                }]);
                handler.webpackRequire = capturedRequire;
            } catch (error) {
                console.debug('[Artist Pulse] Webpack runtime was unavailable.', error);
            }

            return handler.webpackRequire;
        },

        getPlaybackState: function (playbackManager) {
            playbackManager = playbackManager || handler.getPlaybackManager();
            if (!playbackManager) {
                return { itemId: handler.activeSongId, isPlaying: false };
            }

            try {
                var item = typeof playbackManager.currentItem === 'function' ? playbackManager.currentItem() : playbackManager.currentItem;
                var itemId = item && (item.Id || item.id);
                var isPaused = typeof playbackManager.paused === 'function' ? playbackManager.paused() : false;
                if (itemId) {
                    handler.activeSongId = itemId;
                }
                return { itemId: itemId || handler.activeSongId, isPlaying: !!itemId && !isPaused };
            } catch (error) {
                return { itemId: handler.activeSongId, isPlaying: false };
            }
        },

        playSong: function (itemId) {
            var userId = window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null;
            if (!itemId || !userId) {
                return;
            }

            var playbackManager = handler.getPlaybackManager();
            if (!playbackManager || typeof playbackManager.play !== 'function') {
                console.warn('[Artist Pulse] Unable to start playback from Top Songs: Jellyfin playback manager is unavailable.');
                return;
            }

            var state = handler.getPlaybackState(playbackManager);
            if (state.itemId === itemId && typeof playbackManager.playPause === 'function') {
                Promise.resolve(playbackManager.playPause()).then(function () {
                    window.setTimeout(handler.updatePlaybackButtons, 0);
                }).catch(function (error) {
                    console.warn('[Artist Pulse] Unable to toggle Top Songs playback.', error);
                });
                return;
            }

            handler.activeSongId = itemId;
            handler.getTopSongsQueue(userId, itemId).then(function (queue) {
                return playbackManager.play(queue);
            }).then(function () {
                window.setTimeout(handler.updatePlaybackButtons, 0);
            }).catch(function (error) {
                handler.activeSongId = null;
                console.warn('[Artist Pulse] Unable to start playback from Top Songs.', error);
            });
        },

        getTopSongsQueue: function (userId, startingItemId) {
            // A Top Songs click is intentionally a queue, rather than a
            // one-item session. When the current track ends, Jellyfin plays
            // the next locally available ranked track automatically.
            var seenIds = {};
            var rankedIds = ((handler.currentData && handler.currentData.topSongs) || [])
                .filter(function (song) { return song && song.itemId && song.canPlay; })
                .map(function (song) { return song.itemId; })
                .filter(function (itemId) {
                    var key = itemId.toLowerCase();
                    if (seenIds[key]) {
                        return false;
                    }
                    seenIds[key] = true;
                    return true;
                });

            if (!seenIds[startingItemId.toLowerCase()]) {
                rankedIds.unshift(startingItemId);
            }

            return window.ApiClient.getItems(userId, {
                Ids: rankedIds.join(','),
                Recursive: true
            }).then(function (result) {
                var itemsById = {};
                (result.Items || []).forEach(function (item) {
                    itemsById[(item.Id || item.id).toLowerCase()] = item;
                });
                var items = rankedIds.map(function (itemId) {
                    return itemsById[itemId.toLowerCase()];
                }).filter(Boolean);
                var startIndex = rankedIds.indexOf(startingItemId);
                startIndex = items.findIndex(function (item) {
                    return (item.Id || item.id).toLowerCase() === startingItemId.toLowerCase();
                });

                if (!items.length || startIndex < 0) {
                    throw new Error('The selected Top Song is no longer available in this Jellyfin library.');
                }

                return { items: items, startIndex: startIndex };
            });
        },

        updatePlaybackButtons: function () {
            var state = handler.getPlaybackState();
            document.querySelectorAll('.artistInsightsTrack').forEach(function (row) {
                var icon = row.querySelector('.artistInsightsPlaybackState');
                var isCurrent = row.getAttribute('data-id') === state.itemId;
                if (!icon) {
                    return;
                }
                icon.className = 'material-icons artistInsightsPlaybackState ' + (isCurrent && state.isPlaying ? 'pause' : 'play_arrow');
                icon.hidden = !isCurrent;
                row.classList.toggle('artistInsightsTrackPlaying', isCurrent && state.isPlaying);
            });
        },

        openItem: function (itemId) {
            if (itemId) {
                window.location.hash = '#/details?id=' + itemId;
            }
        },

        playItem: function (itemId) {
            if (!itemId || !window.ApiClient || !window.ApiClient._currentUser) {
                return;
            }
            window.ApiClient.getItem(window.ApiClient._currentUser.Id, itemId).then(function (item) {
                if (window.PlaybackManager && window.PlaybackManager.play) {
                    window.PlaybackManager.play({ items: [item], startIndex: 0 });
                }
            });
        },

        toggleNativeFavourite: function (button) {
            var itemId = button.getAttribute('data-favourite-item');
            var userId = window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null;
            if (!itemId || !userId || button.disabled || button.getAttribute('data-updating') === 'true') {
                return;
            }
            var isFavorite = !button.classList.contains('isFavourite');
            button.setAttribute('data-updating', 'true');
            button.disabled = true;
            window.ApiClient.getItem(userId, itemId).then(function (item) {
                item.UserData = item.UserData || {};
                item.UserData.IsFavorite = isFavorite;
                return window.ApiClient.updateUserItemData(userId, itemId, item.UserData);
            }).then(function () {
                handler.setFavouriteState(button, isFavorite);
                handler.updateCachedFavourite(itemId, isFavorite);
            }).catch(function (error) {
                console.warn('[Artist Pulse] Unable to update the favourite state.', error);
            }).finally(function () {
                button.removeAttribute('data-updating');
                button.disabled = false;
            });
        },

        setFavouriteState: function (button, isFavorite) {
            button.classList.toggle('isFavourite', isFavorite);
            button.classList.toggle('btnUserDataOn', isFavorite);
            button.title = isFavorite ? 'Remove from favourites' : 'Add to favourites';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-pressed', String(isFavorite));
            var icon = button.querySelector('.material-icons');
            if (icon) {
                icon.className = 'material-icons ' + (isFavorite ? 'favorite' : 'favorite_border');
            }
        },

        updateCachedFavourite: function (itemId, isFavorite) {
            if (!handler.currentData || !handler.currentData.topSongs) {
                return;
            }

            handler.currentData.topSongs.forEach(function (song) {
                if (song.itemId && song.itemId.toLowerCase() === itemId.toLowerCase()) {
                    song.isFavorite = isFavorite;
                }
            });
        },

        toggleFavourite: function (button) {
            var itemId = button.getAttribute('data-favourite-item');
            var user = window.ApiClient && window.ApiClient._currentUser;
            if (!itemId || !user) {
                return;
            }

            window.ApiClient.getItem(user.Id, itemId).then(function (item) {
                item.UserData = item.UserData || {};
                item.UserData.IsFavorite = !button.classList.contains('isFavourite');
                return window.ApiClient.updateUserItemData(user.Id, itemId, item.UserData);
            }).then(function () {
                button.classList.toggle('isFavourite');
            });
        },

        formatDuration: function (ticks) {
            if (!ticks) {
                return '';
            }
            var seconds = Math.max(0, Math.floor(ticks / 10000000));
            return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        },

        formatNumber: function (value) {
            return new Intl.NumberFormat().format(value || 0);
        },

        escapeHtml: function (value) {
            return String(value || '').replace(/[&<>'"]/g, function (character) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
            });
        }
    };

    window.ArtistInsightsHandler = handler;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handler.init);
    } else {
        handler.init();
    }
}());
