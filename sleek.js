// ── Дефолты конфига (если config.js не подключён) ────────────────────────────
if (typeof l_serverName      === 'undefined') var l_serverName      = '';
if (typeof l_serverImage     === 'undefined') var l_serverImage     = '';
if (typeof l_bgImages        === 'undefined') var l_bgImages        = ['fon.png'];
if (typeof l_bgImagesRandom  === 'undefined') var l_bgImagesRandom  = false;
if (typeof l_bgImageDuration === 'undefined') var l_bgImageDuration = 5000;
if (typeof l_bgImageFadeVelocity==='undefined') var l_bgImageFadeVelocity = 1000;
if (typeof l_bgVideo         === 'undefined') var l_bgVideo         = false;
if (typeof l_background      === 'undefined') var l_background      = '';
if (typeof l_bgOverlay       === 'undefined') var l_bgOverlay       = false;
if (typeof l_bgDarkening     === 'undefined') var l_bgDarkening     = 30;
if (typeof l_music           === 'undefined') var l_music           = false;
if (typeof l_musicVolume     === 'undefined') var l_musicVolume     = 50;
if (typeof l_musicRandom     === 'undefined') var l_musicRandom     = false;
if (typeof l_musicDisplay    === 'undefined') var l_musicDisplay    = false;
if (typeof l_musicPlaylist   === 'undefined') var l_musicPlaylist   = [];
if (typeof l_messagesEnabled === 'undefined') var l_messagesEnabled = false;
if (typeof l_messagesRandom  === 'undefined') var l_messagesRandom  = false;
if (typeof l_messagesFade    === 'undefined') var l_messagesFade    = 500;
if (typeof l_messagesDelay   === 'undefined') var l_messagesDelay   = 5000;
if (typeof l_messages        === 'undefined') var l_messages        = [];
// ─────────────────────────────────────────────────────────────────────────────

// Array randomizer (Fisher-Yates algorithm)
function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;
  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }
  return array;
}

var neededFiles;
var downloadedFiles = 0;

// Глобально сохраняем steamid — GameDetails может вызваться раньше чем загрузится страница
var _pendingSteamId = null;

/**
 * GameDetails вызывается движком GMod.
 * steamid приходит в формате STEAM_0:X:Y
 */
function GameDetails(servername, serverurl, mapname, maxplayers, steamid, gamemode) {
  setGamemode(gamemode);
  setMapname(mapname);

  if (!l_serverName && !l_serverImage) {
    setServerName(servername);
  }

  if (steamid) {
    _pendingSteamId = steamid;
    // Если страница уже готова — вызываем сразу, иначе DOMContentLoaded подхватит
    if (typeof loadPlayerCard === 'function') {
      loadPlayerCard(steamid);
    }
  }
}

function DownloadingFile(fileName) {
  downloadedFiles++;
  refreshProgress();
  setStatus("Downloading Addons, Maps, etc");
}

function SetStatusChanged(status) {
  if (status.indexOf("Downloading the addon named : #") != -1) {
    downloadedFiles++;
    refreshProgress();
  } else if (status == "Sending Client Info") {
    setProgress(100);
  }
  setStatus(status);
}

function SetFilesNeeded(needed) {
  neededFiles = needed + 1;
}

function refreshProgress() {
  var progress = Math.floor(((downloadedFiles / neededFiles) * 100));
  setProgress(progress);
}

function setStatus(text) {}

function setProgress(progress) {
  $("#loading-progress").css("width", progress + "%");
}

function setGamemode(gamemode) {
  $("#gamemode").html(gamemode);
}

function setMapname(mapname) {
  $("#map").html(mapname);
}

function setServerName(servername) {
  $("#title").html(servername);
}

function setMusicName(name) {
  $("#music-name").fadeOut(2000, function () {
    $(this).html(name);
    $(this).fadeIn(2000);
  });
}

var youtubePlayer;
var actualMusic = -1;

$(function () {
  if (l_bgImagesRandom) l_bgImages = shuffle(l_bgImages);
  if (l_musicRandom) l_musicPlaylist = shuffle(l_musicPlaylist);
  if (l_messagesRandom) l_messages = shuffle(l_messages);
  if (l_messagesEnabled) showMessage(0);

  if (l_music) {
    loadYoutube();
    if (l_musicDisplay) $("#music").fadeIn(2000);
  }

  if (l_bgVideo) {
    $("body").append("<video loop autoplay muted><source src='" + l_background + "' type='video/webm'></video>");
  } else {
//    $.backstretch(l_bgImages, { duration: l_bgImageDuration, fade: l_bgImageFadeVelocity });
  }

  if (l_serverName && !l_serverImage) setServerName(l_serverName);
  if (l_serverImage) setServerName("<img src='" + l_serverImage + "'>");
  if (l_bgOverlay) $("#overlay").css("background-image", "url('images/overlay.png')");
  $("#overlay").css("background-color", "rgba(0,0,0," + (l_bgDarkening / 100) + ")");
});

function loadYoutube() {
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

function onYouTubeIframeAPIReady() {
  youtubePlayer = new YT.Player('player', {
    height: '390', width: '640',
    events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
  });
}

function onPlayerReady(event) {
  youtubePlayer.setVolume(l_musicVolume);
  if (youtubePlayer.isMuted()) youtubePlayer.unMute();
  nextMusic();
}

function onPlayerStateChange(event) {
  if (event.data == YT.PlayerState.ENDED) nextMusic();
}

function nextMusic() {
  actualMusic++;
  if (actualMusic >= l_musicPlaylist.length) actualMusic = 0;
  var atual = l_musicPlaylist[actualMusic];
  if (atual.youtube) {
    youtubePlayer.loadVideoById(atual.youtube);
  } else {
    $("body").append('<audio src="' + atual.ogg + '" autoplay>');
    $("audio").prop('volume', l_musicVolume / 100);
    $("audio").bind("ended", function () { $(this).remove(); nextMusic(); });
  }
  setMusicName(atual.name);
}

function showMessage(message) {
  if (message >= l_messages.length) message = 0;
  $("#messages").fadeOut(l_messagesFade, function () {
    $(this).html(l_messages[message]);
    $(this).fadeIn(l_messagesFade);
  });
  setTimeout(function () { showMessage(message + 1); }, l_messagesDelay + l_messagesFade * 2);
}