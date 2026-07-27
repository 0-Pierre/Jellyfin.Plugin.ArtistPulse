(function () {
    'use strict';

    if (window.ArtistInsightsHandler) {
        return;
    }

    var handler = {
        currentArtistId: null,
        currentData: null,
        requestInFlight: false,
        requestGeneration: 0,
        renderTimer: null,
        renderRetryTimer: null,
        renderRetryAttempts: 0,
        emptyTopSongsRetryAttempts: 0,
        emptyTopSongsRetryArtistId: null,
        nextRequestNotBefore: 0,
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
            // Some Jellyfin themes and slow library pages populate artist
            // sections after the normal DOM mutation burst has finished.
            // Keep a lightweight safety check so an artist never needs F5.
            window.setInterval(handler.ensureArtistRendered, 1000);
            handler.schedule();
        },

        ensureArtistRendered: function () {
            var artistId = handler.getArtistId();
            if (artistId && handler.currentArtistId === artistId && handler.currentData && handler.needsRender(handler.currentData)) {
                handler.schedule();
            }
        },

        schedule: function () {
            window.clearTimeout(handler.renderTimer);
            handler.renderTimer = window.setTimeout(handler.process, 90);
        },

        process: function () {
            var artistId = handler.getArtistId();
            if (!artistId) {
                handler.cancelRenderRetry();
                handler.requestGeneration++;
                handler.currentArtistId = null;
                handler.currentData = null;
                handler.emptyTopSongsRetryAttempts = 0;
                handler.emptyTopSongsRetryArtistId = null;
                handler.nextRequestNotBefore = 0;
                // Jellyfin keeps detail DOM alive while changing views. Do
                // not leak Artist Pulse content into the cached Queue view.
                handler.removeArtistInsights();
                return;
            }

            // Do not reset the bounded empty-response backoff below: it
            // intentionally clears currentArtistId before retrying the same
            // route. A real artist change (or an initial navigation) still
            // gets a new request generation immediately.
            if (handler.currentArtistId !== artistId &&
                (handler.currentArtistId !== null ||
                    !handler.nextRequestNotBefore ||
                    handler.emptyTopSongsRetryArtistId !== artistId)) {
                handler.cancelRenderRetry();
                handler.requestGeneration++;
                handler.emptyTopSongsRetryAttempts = 0;
                handler.emptyTopSongsRetryArtistId = null;
                handler.nextRequestNotBefore = 0;
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

            // During the first Jellyfin Web boot, the authenticated request
            // can occasionally race the initial client state and return an
            // empty chart. Retry a few times with backoff rather than making
            // the user refresh the page.
            var waitForRetry = handler.nextRequestNotBefore - Date.now();
            if (waitForRetry > 0) {
                window.setTimeout(handler.process, waitForRetry);
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
            var requestGeneration = handler.requestGeneration;
            try {
                Promise.resolve(window.ApiClient.ajax({
                    url: window.ApiClient.getUrl('ArtistInsights/artist/' + encodeURIComponent(artistId)),
                    type: 'GET',
                    dataType: 'json'
                })).then(function (data) {
                    if (requestGeneration !== handler.requestGeneration || handler.getArtistId() !== artistId) {
                        return;
                    }
                    handler.currentArtistId = artistId;
                    handler.currentData = handler.normaliseResponse(data);
                    handler.renderRetryAttempts = 0;
                    if (!handler.currentData.topSongs.length && handler.emptyTopSongsRetryAttempts < 4) {
                        handler.emptyTopSongsRetryAttempts++;
                        handler.emptyTopSongsRetryArtistId = artistId;
                        handler.currentArtistId = null;
                        handler.currentData = null;
                        handler.nextRequestNotBefore = Date.now() + (750 * Math.pow(2, handler.emptyTopSongsRetryAttempts - 1));
                        return;
                    }
                    handler.emptyTopSongsRetryAttempts = 0;
                    handler.emptyTopSongsRetryArtistId = null;
                    handler.nextRequestNotBefore = 0;
                    handler.render(handler.currentData);
                }).catch(function () {
                    // The endpoint returns 404 for any non-artist detail page. This is expected.
                    handler.currentData = null;
                }).finally(function () {
                    handler.requestInFlight = false;
                    handler.schedule();
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
            var albums = property(response, 'albums') || [];
            var singles = property(response, 'singles') || [];
            var similarArtists = property(response, 'similarArtists') || [];
            var normaliseRelease = function (release) {
                return {
                    id: property(release, 'id'),
                    name: property(release, 'name'),
                    year: property(release, 'year'),
                    trackCount: property(release, 'trackCount'),
                    imageItemId: property(release, 'imageItemId')
                };
            };

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
                albums: albums.map(normaliseRelease),
                singles: singles.map(normaliseRelease),
                similarArtists: similarArtists.map(function (artist) {
                    return {
                        name: property(artist, 'name'),
                        itemId: property(artist, 'itemId'),
                        imageItemId: property(artist, 'imageItemId')
                    };
                })
            };
        },

        render: function (data) {
            var albumsSection = handler.sectionForTitle('Albums');
            if (!albumsSection) {
                // Artist pages are progressively populated by Jellyfin Web.
                // Render under Genres as soon as it exists, then move Top
                // Songs above Albums when the album carousel arrives.
                var genresSection = handler.sectionForTitle('Genres');
                if (genresSection) {
                    handler.renderTopSongs(data, handler.getArtistSectionContainer(genresSection), 'after');
                }
                handler.scheduleRenderRetry();
                return;
            }

            handler.cancelRenderRetry();
            // Jellyfin Web wraps the stock Albums section in an anonymous
            // element. Insert independent Artist Pulse sections beside it so
            // that its album-card background cannot wrap our new sections.
            var albumsContainer = handler.getArtistSectionContainer(albumsSection);
            handler.renderTopSongs(data, albumsContainer, 'before');
            handler.renderAlbums(data, albumsContainer);
            handler.renderSingles(data, albumsContainer);
            handler.renderSimilarArtists(data, albumsContainer);
            handler.hideNativeMoreLikeThis();
        },

        cancelRenderRetry: function () {
            window.clearTimeout(handler.renderRetryTimer);
            handler.renderRetryTimer = null;
            handler.renderRetryAttempts = 0;
        },

        scheduleRenderRetry: function () {
            if (handler.renderRetryTimer || handler.renderRetryAttempts >= 240) {
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
            if (!document.querySelector('.artistInsightsNativeAlbums')) {
                return true;
            }
            if (data.albums && data.albums.length && !document.querySelector('.artistInsightsAlbums')) {
                return true;
            }
            if (data.singles && data.singles.length && !document.querySelector('.artistInsightsSingles')) {
                return true;
            }
            if (data.similarArtists && data.similarArtists.length && !document.querySelector('.artistInsightsSimilarArtists')) {
                return true;
            }
            var moreLikeThis = handler.sectionForTitle('More Like This');
            return !!(moreLikeThis && !handler.getArtistSectionContainer(moreLikeThis).classList.contains('artistInsightsNativeMoreLikeThis'));
        },

        renderTopSongs: function (data, anchorContainer, placement) {
            var existing = document.querySelector('.artistInsightsTopSongs');
            if (existing && existing.getAttribute('data-artist-insights-placement') === placement) {
                return;
            }
            if (existing) {
                existing.remove();
            }

            if (!data.topSongs || !data.topSongs.length) {
                return;
            }

            var section = document.createElement('div');
            section.className = 'artistInsightsTopSongs';
            section.setAttribute('data-artist-insights', 'top-songs');
            section.setAttribute('data-artist-insights-placement', placement);

            var heading = document.createElement('div');
            heading.className = 'artistInsightsHeading';
            heading.innerHTML = '<h2 class="sectionTitle">Top Songs</h2>';
            if (data.topSongsSource === 'listenbrainz') {
                heading.title = 'Ranked by ListenBrainz; only tracks available on this server are shown.';
            } else if (data.topSongsSource === 'mixed') {
                heading.title = 'Local Jellyfin ranking, completed with unique ListenBrainz tracks available on this server.';
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
                // Keep the native button element for theme-aware keyboard
                // focus, but present it as a lightweight text action.
                showMore.className = 'emby-button artistInsightsTextControl artistInsightsShowMore';
                showMore.setAttribute('is', 'emby-button');
                showMore.type = 'button';
                showMore.innerHTML = '<span class="artistInsightsControlLabel"></span><span class="material-icons keyboard_arrow_down" aria-hidden="true"></span>';
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
                showLess.className = 'emby-button artistInsightsTextControl artistInsightsShowLess';
                showLess.setAttribute('is', 'emby-button');
                showLess.type = 'button';
                showLess.innerHTML = '<span class="artistInsightsControlLabel">Show less</span><span class="material-icons keyboard_arrow_up" aria-hidden="true"></span>';
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
            if (placement === 'after') {
                anchorContainer.parentNode.insertBefore(section, anchorContainer.nextSibling);
            } else {
                anchorContainer.parentNode.insertBefore(section, anchorContainer);
            }
        },

        updateTopSongsControls: function (showMore, showLess, grid) {
            var remaining = grid.querySelectorAll('.artistInsightsTrackHidden').length;
            var visible = grid.querySelectorAll('.artistInsightsTrack').length - remaining;
            showMore.hidden = remaining === 0;
            showLess.hidden = visible <= handler.initialTopSongs;
            var showMoreLabel = showMore.querySelector('.artistInsightsControlLabel');
            if (showMoreLabel) {
                showMoreLabel.textContent = 'Show more (' + remaining + ')';
            }
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
            grid.setAttribute('data-artist-insights-columns', String(columns));
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
                '<button is="paper-icon-button-light" class="mediaButton paper-icon-button-light emby-button artistInsightsFavourite" type="button" data-likes="undefined" title="Add to favourites" aria-label="Add to favourites"><span class="material-icons favorite" aria-hidden="true"></span></button>' +
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
                favouriteButton.setAttribute('data-id', song.itemId);
                favouriteButton.setAttribute('data-itemtype', 'Audio');
                favouriteButton.setAttribute('data-isfavorite', String(!!song.isFavorite));
            }
            var favouriteServerId = handler.getServerId();
            if (favouriteServerId) {
                favouriteButton.setAttribute('data-serverid', favouriteServerId);
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
            // Keep Jellyfin's native rating state classes while owning the
            // request ourselves. The rating web component may asynchronously
            // replace state after a click, so use the native icon-button host.
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

        renderAlbums: function (data, albumsContainer) {
            handler.removeAlbums();
            // Jellyfin caps its native artist carousel and exposes the rest
            // behind a More button. Replace it with the complete release list
            // supplied by the server so every album is visible immediately.
            albumsContainer.classList.add('artistInsightsNativeAlbums');

            if (!data.albums || !data.albums.length) {
                return;
            }

            var section = document.createElement('div');
            section.className = 'artistInsightsAlbums';
            section.setAttribute('data-artist-insights', 'albums');
            section.innerHTML = '<div class="artistInsightsHeading"><h2 class="sectionTitle">Albums</h2></div>';
            section.appendChild(handler.createNativeReleaseCards(data.albums));
            albumsContainer.parentNode.insertBefore(section, albumsContainer);
        },

        removeAlbums: function () {
            document.querySelectorAll('.artistInsightsAlbums').forEach(function (section) { section.remove(); });
            document.querySelectorAll('.artistInsightsNativeAlbums').forEach(function (section) {
                section.classList.remove('artistInsightsNativeAlbums');
            });
        },

        createNativeReleaseCards: function (releases) {
            var container = document.createElement('div');
            // Keep the markup native so every Jellyfin theme controls card
            // size, spacing, colours, focus rings and hover behaviour.
            container.className = 'itemsContainer vertical-wrap';
            releases.forEach(function (release) {
                container.appendChild(handler.createNativeReleaseCard(release));
            });
            return container;
        },

        renderSingles: function (data, albumsContainer) {
            handler.removeSingles();

            if (!data.singles || !data.singles.length) {
                return;
            }

            var section = document.createElement('div');
            section.className = 'artistInsightsSingles';
            section.setAttribute('data-artist-insights', 'singles');
            section.innerHTML = '<div class="artistInsightsHeading"><h2 class="sectionTitle">Singles</h2></div>';
            section.appendChild(handler.createNativeReleaseCards(data.singles));
            albumsContainer.parentNode.insertBefore(section, albumsContainer.nextSibling);
        },

        removeSingles: function () {
            document.querySelectorAll('.artistInsightsSingles').forEach(function (section) { section.remove(); });
        },

        removeArtistInsights: function () {
            document.querySelectorAll('.artistInsightsTopSongs').forEach(function (section) { section.remove(); });
            handler.removeAlbums();
            handler.removeSingles();
            handler.removeSimilarArtists();
            document.querySelectorAll('.artistInsightsNativeMoreLikeThis').forEach(function (section) {
                section.classList.remove('artistInsightsNativeMoreLikeThis');
            });
        },

        hideNativeMoreLikeThis: function () {
            var section = handler.sectionForTitle('More Like This');
            if (section) {
                handler.getArtistSectionContainer(section).classList.add('artistInsightsNativeMoreLikeThis');
            }
        },

        renderSimilarArtists: function (data, albumsContainer) {
            handler.removeSimilarArtists();

            if (!data.similarArtists || !data.similarArtists.length) {
                return;
            }

            var section = document.createElement('div');
            // Match Jellyfin Web's Cast & Crew section exactly: the native
            // carousel classes (rather than the portrait-card classes) are
            // what make the cards form one horizontal, button-scrollable row.
            section.className = 'verticalSection detailVerticalSection emby-scroller-container artistInsightsSimilarArtists';
            section.setAttribute('data-artist-insights', 'similar-artists');
            section.innerHTML = '<h2 class="sectionTitle sectionTitle-cards padded-right" title="Recommendations from ListenBrainz">Similar Artists</h2>';

            var scrollButtons = document.createElement('div');
            scrollButtons.setAttribute('is', 'emby-scrollbuttons');
            scrollButtons.className = 'emby-scrollbuttons padded-right';

            // Preserve Jellyfin Web's two-level Cast & Crew carousel. The
            // outer emby-scroller applies the native person-card geometry;
            // its inner emby-itemscontainer owns the horizontal animation.
            var scroller = document.createElement('div');
            scroller.setAttribute('is', 'emby-scroller');
            scroller.className = 'padded-top-focusscale padded-bottom-focusscale no-padding emby-scroller artistInsightsSimilarArtistsScroller';
            scroller.setAttribute('data-centerfocus', 'true');
            scroller.setAttribute('data-scroll-mode-x', 'custom');

            var artists = document.createElement('div');
            artists.setAttribute('is', 'emby-itemscontainer');
            // Deliberately use the stock movie-detail ID. Several Jellyfin
            // themes style #castContent person cards as circular avatars.
            // Artist pages do not have a Cast section, so the ID is unique.
            artists.id = 'castContent';
            artists.className = 'scrollSlider focuscontainer-x itemsContainer animatedScrollX';
            data.similarArtists.forEach(function (artist) {
                artists.appendChild(handler.createNativeSimilarArtistCard(artist));
            });
            section.appendChild(scrollButtons);
            scroller.appendChild(artists);
            section.appendChild(scroller);

            // This is deliberately the final injected section. When Singles
            // are enabled it follows them; otherwise it follows Albums.
            var previous = document.querySelector('.artistInsightsSingles') || document.querySelector('.artistInsightsAlbums');
            albumsContainer.parentNode.insertBefore(section, previous ? previous.nextSibling : albumsContainer.nextSibling);
            handler.bindSimilarArtistScrollButtons(section, scrollButtons, artists);
        },

        removeSimilarArtists: function () {
            document.querySelectorAll('.artistInsightsSimilarArtists').forEach(function (section) { section.remove(); });
        },

        bindSimilarArtistScrollButtons: function (section, scrollButtons, artists) {
            var updateButtons = function () {
                if (!section.isConnected) {
                    return;
                }

                var maxScrollLeft = Math.max(0, artists.scrollWidth - artists.clientWidth);
                var hasOverflow = maxScrollLeft > 1;
                scrollButtons.querySelectorAll('button[data-direction]').forEach(function (button) {
                    var direction = button.getAttribute('data-direction');
                    button.disabled = !hasOverflow ||
                        (direction === 'left' ? artists.scrollLeft <= 1 : artists.scrollLeft >= maxScrollLeft - 1);
                });
            };

            // Capture the dynamically created native buttons before their
            // original handler. The browser scroll range above is reliable for
            // content inserted after Jellyfin Web's page initialization.
            scrollButtons.addEventListener('click', function (event) {
                var target = event.target && event.target.closest ? event.target.closest('button[data-direction]') : null;
                if (!target) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                if (!target.disabled) {
                    var direction = target.getAttribute('data-direction');
                    artists.scrollBy({
                        left: (direction === 'right' ? 1 : -1) * Math.max(artists.clientWidth * .8, 220),
                        behavior: 'smooth'
                    });
                }
                window.setTimeout(updateButtons, 250);
            }, true);
            artists.addEventListener('scroll', updateButtons, { passive: true });

            // emby-scrollbuttons creates its child buttons after this section
            // is connected, so calculate their initial state on the next turn.
            window.setTimeout(updateButtons, 0);
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
            imageLink.href = '#/details?id=' + release.id + (serverId ? '&serverId=' + serverId : '');
            imageLink.setAttribute('data-action', 'link');
            imageLink.setAttribute('data-id', release.id);
            imageLink.setAttribute('data-type', 'MusicAlbum');
            imageLink.setAttribute('data-mediatype', 'Audio');
            imageLink.setAttribute('data-isfolder', 'true');
            imageLink.setAttribute('aria-label', release.name || 'Album');
            imageLink.setAttribute('role', 'img');
            if (serverId) {
                imageLink.setAttribute('data-serverid', serverId);
            }
            if (release.imageItemId) {
                imageLink.style.backgroundImage = 'url("' + window.ApiClient.getUrl('Items/' + release.imageItemId + '/Images/Primary?fillHeight=300&fillWidth=300&quality=90') + '")';
            }

            // Match the stock MusicAlbum card markup. In particular, the
            // overlay lives inside cardScalable: themes use that relationship
            // to show the native green/brand-coloured quick-play button.
            var overlay = document.createElement('div');
            overlay.className = 'cardOverlayContainer itemAction';
            overlay.setAttribute('data-action', 'link');
            var playButton = document.createElement('button');
            playButton.setAttribute('is', 'paper-icon-button-light');
            playButton.className = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light cardOverlayFab-primary';
            playButton.setAttribute('data-action', 'resume');
            playButton.title = 'Play';
            playButton.innerHTML = '<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow" aria-hidden="true"></span>';
            playButton.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                handler.playRelease(release.id);
            });
            var overlayActions = document.createElement('div');
            overlayActions.className = 'cardOverlayButton-br flex';
            var favouriteButton = document.createElement('button');
            favouriteButton.setAttribute('is', 'emby-ratingbutton');
            favouriteButton.type = 'button';
            favouriteButton.className = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light emby-button';
            favouriteButton.setAttribute('data-action', 'none');
            favouriteButton.setAttribute('data-id', release.id);
            favouriteButton.setAttribute('data-itemtype', 'MusicAlbum');
            favouriteButton.setAttribute('data-likes', '');
            favouriteButton.setAttribute('data-isfavorite', 'false');
            favouriteButton.title = 'Add to favourites';
            favouriteButton.innerHTML = '<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover favorite" aria-hidden="true"></span>';
            var menuButton = document.createElement('button');
            menuButton.setAttribute('is', 'paper-icon-button-light');
            menuButton.className = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light';
            menuButton.setAttribute('data-action', 'menu');
            menuButton.title = 'More';
            menuButton.innerHTML = '<span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover more_vert" aria-hidden="true"></span>';
            if (serverId) {
                favouriteButton.setAttribute('data-serverid', serverId);
            }
            overlayActions.appendChild(favouriteButton);
            overlayActions.appendChild(menuButton);
            overlay.appendChild(playButton);
            overlay.appendChild(overlayActions);

            var title = document.createElement('div');
            title.className = 'cardText cardTextCentered cardText-first';
            var titleBdi = document.createElement('bdi');
            // Keep this as native card text, rather than a textActionButton.
            // Some themes style interactive title links as selected/editable.
            titleBdi.textContent = release.name || 'Album';
            title.appendChild(titleBdi);
            var year = document.createElement('div');
            year.className = 'cardText cardTextCentered cardText-secondary';
            year.textContent = release.year || '';
            scalable.appendChild(padder);
            scalable.appendChild(imageLink);
            scalable.appendChild(overlay);
            box.appendChild(scalable);
            // Native cards keep their title and secondary text beside the
            // scalable cover layer; placing them inside it clips the text.
            box.appendChild(title);
            box.appendChild(year);
            card.appendChild(box);
            return card;
        },

        createNativeSimilarArtistCard: function (artist) {
            var serverId = handler.getServerId();
            var card = document.createElement('div');
            card.className = 'card overflowPortraitCard personCard card-hoverable card-withuserdata artistInsightsSimilarArtistCard';
            card.setAttribute('data-id', artist.itemId);
            card.setAttribute('data-type', 'MusicArtist');
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
            padder.className = 'cardPadder cardPadder-overflowPortrait';
            padder.innerHTML = '<span class="cardImageIcon material-icons person" aria-hidden="true"></span>';
            var imageLink = document.createElement('a');
            imageLink.className = 'cardImageContainer coveredImage cardContent itemAction';
            imageLink.href = '#/details?id=' + artist.itemId + (serverId ? '&serverId=' + serverId : '');
            imageLink.setAttribute('aria-label', artist.name || 'Artist');
            imageLink.setAttribute('role', 'img');
            imageLink.setAttribute('data-action', 'link');
            imageLink.setAttribute('data-id', artist.itemId);
            imageLink.setAttribute('data-type', 'MusicArtist');
            imageLink.setAttribute('data-mediatype', 'Audio');
            imageLink.setAttribute('data-isfolder', 'true');
            if (serverId) {
                imageLink.setAttribute('data-serverid', serverId);
            }
            if (artist.imageItemId) {
                imageLink.style.backgroundImage = 'url("' + window.ApiClient.getUrl('Items/' + artist.imageItemId + '/Images/Primary?fillHeight=300&fillWidth=300&quality=90') + '")';
            }

            var title = document.createElement('div');
            title.className = 'cardText cardTextCentered cardText-first';
            var titleBdi = document.createElement('bdi');
            titleBdi.textContent = artist.name || 'Artist';
            title.appendChild(titleBdi);
            scalable.appendChild(padder);
            scalable.appendChild(imageLink);
            box.appendChild(scalable);
            box.appendChild(title);
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
                icon.textContent = isCurrent && state.isPlaying ? 'pause' : 'play_arrow';
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
            var endpoint = window.ApiClient.getUrl('Users/' + encodeURIComponent(userId) + '/FavoriteItems/' + encodeURIComponent(itemId));
            Promise.resolve(window.ApiClient.ajax({
                url: endpoint,
                type: isFavorite ? 'POST' : 'DELETE'
            })).then(function () {
                handler.setFavouriteState(button, isFavorite);
                handler.updateCachedFavourite(itemId, isFavorite);
            }).catch(function (error) {
                console.warn('[Artist Pulse] Unable to update the favourite state.', error);
            }).finally(function () {
                button.removeAttribute('data-updating');
                button.disabled = false;
            });
        },

        playRelease: function (releaseId) {
            var userId = window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function' ? window.ApiClient.getCurrentUserId() : null;
            var playbackManager = handler.getPlaybackManager();
            if (!releaseId || !userId || !playbackManager || typeof playbackManager.play !== 'function') {
                console.warn('[Artist Pulse] Unable to start playback from a Single: Jellyfin playback manager is unavailable.');
                return;
            }

            window.ApiClient.getItems(userId, {
                ParentId: releaseId,
                IncludeItemTypes: 'Audio',
                Recursive: true,
                SortBy: 'ParentIndexNumber,IndexNumber',
                SortOrder: 'Ascending'
            }).then(function (result) {
                var items = (result.Items || []).filter(function (item) {
                    return item && (item.Id || item.id);
                });
                if (!items.length) {
                    throw new Error('This release has no playable tracks in the Jellyfin library.');
                }
                return playbackManager.play({ items: items, startIndex: 0 });
            }).catch(function (error) {
                console.warn('[Artist Pulse] Unable to start playback from a Single.', error);
            });
        },

        setFavouriteState: function (button, isFavorite) {
            button.classList.toggle('isFavourite', isFavorite);
            // Jellyfin themes conventionally target the American spelling;
            // retain the original class for internal state compatibility.
            button.classList.toggle('isFavorite', isFavorite);
            button.classList.toggle('ratingbutton-withrating', isFavorite);
            button.setAttribute('data-isfavorite', String(isFavorite));
            button.title = isFavorite ? 'Favourite' : 'Add to favourites';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-pressed', String(isFavorite));
            var icon = button.querySelector('.material-icons');
            if (icon) {
                icon.className = 'material-icons favorite' + (isFavorite ? ' ratingbutton-icon-withrating' : '');
                icon.textContent = '';
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
            handler.toggleNativeFavourite(button);
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
