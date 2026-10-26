--[[
  cglive.lua -- OBS script for CG Live (scoreboard_athletics)
  OBS: Tools -> Scripts -> "+" -> pick this file.

  What it does
    1. "Create CG Live scene + sources" button: makes a scene with two Browser
       Sources at 1920x1080 -- /live (sports CG) and /live/cg (Lower Third / Bar)
       with "Shutdown source when not visible" OFF, as the README recommends.
    2. Hotkeys (bind them in Settings -> Hotkeys):
         CG Live: hide all           -> l3HideAll
         CG Live: hide main graphic  -> l3HideAll, keeping top/ticker/bug up
         CG Live: air item 1..20     -> l3Air with that position in the library
       "item N" means the Nth entry of the Lower Third library in the order it
       appears on /cg. The server resolves it, so this script needs no JSON
       parser and no copy of the CG type registry.

  HTTP note
    OBS's Lua has no HTTP client, so this shells out to curl:
      - Windows 10/11 ships curl.exe in System32
      - macOS and most Linux distros ship curl too
    The request body is staged in a temp file and passed as `-d @file`, which
    sidesteps Windows command-line quoting entirely. POSTs are fired detached so
    the OBS UI never blocks, and no console window appears. If your box has no
    curl, see the note at the bottom of this file.

  This script only drives the Lower Third channel (state.l3). It never touches
  the sports data.
]]

local obs = obslua

-- ---------------------------------------------------------------- settings --
local server     = "http://127.0.0.1:8080"
local token      = ""
local scene_name = "CG Live"

-- 20 "air item N" hotkeys are always registered; bind only the ones you need.
-- N is the position in the Lower Third library as shown on /cg (1 = first).
local ITEM_HOTKEYS = 20

local hotkeys = {}          -- id -> obs hotkey id

-- ------------------------------------------------------------------ helpers --
local function is_windows()
  return package.config:sub(1, 1) == "\\"
end

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- strip a trailing slash so server .. "/api/..." never doubles up
local function base_url()
  local u = trim(server)
  while u:sub(-1) == "/" do u = u:sub(1, -2) end
  return u
end

-- shell-quote for the platform
local function q(s)
  s = tostring(s or "")
  if is_windows() then
    -- cmd.exe: double quotes, and " inside must be escaped for curl's parser
    return '"' .. s:gsub('"', '\\"') .. '"'
  end
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

-- Where to stage the request body. Putting JSON in a file instead of on the
-- command line avoids the whole Windows quote-escaping minefield (the body is
-- full of double quotes, and cmd.exe and curl disagree about how to unescape
-- them). curl reads it back with `-d @file`.
local function tmp_body_path()
  local dir = os.getenv("TEMP") or os.getenv("TMP") or "/tmp"
  local sep = is_windows() and "\\" or "/"
  return dir .. sep .. "cglive_cmd.json"
end

local function write_body(body)
  local path = tmp_body_path()
  local f = io.open(path, "wb")
  if not f then return nil end
  f:write(body)
  f:close()
  return path
end

-- Fire a POST /api/command without blocking the OBS UI. body must be JSON.
local function post_command(body)
  local url = base_url() .. "/api/command"
  local path = write_body(body)
  if not path then
    obs.script_log(obs.LOG_WARNING, "CG Live: cannot write temp file for the request")
    return
  end
  local hdr = "Content-Type: application/json; charset=utf-8"
  local tok = token:gsub('[\r\n"]', "")
  if is_windows() then
    -- `start "" /B` detaches and creates no console window of its own
    local c = 'start "" /B curl.exe -s -m 5 -o NUL -H ' .. q(hdr)
    if tok ~= "" then c = c .. " -H " .. q("X-Token: " .. tok) end
    c = c .. " -d " .. q("@" .. path) .. " " .. q(url)
    os.execute(c)
  else
    local c = "curl -s -m 5 -o /dev/null -H " .. q(hdr)
    if tok ~= "" then c = c .. " -H " .. q("X-Token: " .. tok) end
    c = c .. " -d " .. q("@" .. path) .. " " .. q(url) .. " >/dev/null 2>&1 &"
    os.execute(c)
  end
end

-- Blocking GET that returns the body as a string (used only for the buttons,
-- never from a hotkey, so a short stall is fine).
local function http_get(path)
  local url = base_url() .. path
  local cmd
  if is_windows() then
    cmd = 'curl.exe -s -m 6 ' .. q(url) .. ' 2>NUL'
  else
    cmd = "curl -s -m 6 " .. q(url) .. " 2>/dev/null"
  end
  local pipe = io.popen(cmd, "r")
  if not pipe then return nil end
  local out = pipe:read("*a")
  pipe:close()
  return out
end

-- ------------------------------------------------------------- commands -----
-- Everything below is a fixed JSON literal with at most an integer spliced in.
-- This script deliberately contains NO JSON parser and NO copy of the CG type
-- registry: the server's "l3Air" command looks the item up in l3.items (by
-- 1-based position) and assembles the on-air payload from the item itself.
-- So adding a new CG type in templates.js needs no change here.
local function cmd_hide_all()
  post_command('{"action":"l3HideAll"}')
end

local function cmd_hide_main()
  post_command('{"action":"l3HideAll","keep":["top","ticker","bug"]}')
end

local function cmd_air_item(index)
  post_command('{"action":"l3Air","index":' .. tostring(math.floor(index)) .. "}")
end

-- --------------------------------------------------------- scene builder ----
local function add_browser_source(scene, name, url)
  local existing = obs.obs_get_source_by_name(name)
  if existing ~= nil then
    obs.obs_source_release(existing)
    obs.script_log(obs.LOG_INFO, "CG Live: source '" .. name .. "' already exists, skipped")
    return
  end
  local settings = obs.obs_data_create()
  obs.obs_data_set_string(settings, "url", url)
  obs.obs_data_set_int(settings, "width", 1920)
  obs.obs_data_set_int(settings, "height", 1080)
  -- keep the page alive so the CG does not reload every time you cut away
  obs.obs_data_set_bool(settings, "shutdown", false)
  obs.obs_data_set_bool(settings, "restart_when_active", false)

  local src = obs.obs_source_create("browser_source", name, settings, nil)
  if src ~= nil then
    obs.obs_scene_add(scene, src)
    obs.obs_source_release(src)
    obs.script_log(obs.LOG_INFO, "CG Live: created source '" .. name .. "' -> " .. url)
  else
    obs.script_log(obs.LOG_WARNING, "CG Live: failed to create '" .. name .. "'")
  end
  obs.obs_data_release(settings)
end

local function create_scene()
  local base = base_url()
  local existing = obs.obs_get_source_by_name(scene_name)
  local scene
  if existing ~= nil then
    scene = obs.obs_scene_from_source(existing)
    if scene == nil then
      obs.obs_source_release(existing)
      obs.script_log(obs.LOG_WARNING,
        "CG Live: '" .. scene_name .. "' exists but is not a scene -- rename it and retry")
      return
    end
    obs.script_log(obs.LOG_INFO, "CG Live: reusing scene '" .. scene_name .. "'")
    add_browser_source(scene, "CG Live - Sports", base .. "/live")
    add_browser_source(scene, "CG Live - Lower Third", base .. "/live/cg")
    obs.obs_source_release(existing)
    return
  end

  scene = obs.obs_scene_create(scene_name)
  if scene == nil then
    obs.script_log(obs.LOG_WARNING, "CG Live: could not create scene")
    return
  end
  add_browser_source(scene, "CG Live - Sports", base .. "/live")
  add_browser_source(scene, "CG Live - Lower Third", base .. "/live/cg")
  obs.obs_scene_release(scene)
  obs.script_log(obs.LOG_INFO, "CG Live: scene '" .. scene_name .. "' ready")
end

local function test_connection()
  local body = http_get("/healthz")
  if body and trim(body) == "ok" then
    obs.script_log(obs.LOG_INFO, "CG Live: connected to " .. base_url()
      .. " -- hotkeys are ready (bind them in Settings -> Hotkeys)")
  else
    obs.script_log(obs.LOG_WARNING, "CG Live: no answer from " .. base_url()
      .. "/healthz -- check the URL, that the server is running, and that curl exists")
  end
end

-- -------------------------------------------------------------- OBS hooks ---
function script_description()
  return [[<h3>CG Live</h3>
<p>Controls the <b>Lower Third / Bar</b> channel of CG Live
(<code>/cg</code> &rarr; <code>/live/cg</code>).</p>
<ol>
<li>Set the server URL (and token, if the server was started with one).</li>
<li><b>Create CG Live scene + sources</b> makes the two 1920&times;1080 Browser
Sources for you.</li>
<li>Bind the <b>CG Live:</b> hotkeys in <b>Settings &rarr; Hotkeys</b>.</li>
</ol>
<p>Tip: the full control panel also fits in a dock &mdash;
<b>Docks &rarr; Custom Browser Docks</b>, URL <code>&lt;server&gt;/obs</code>.</p>
<p><small>Needs <code>curl</code> (bundled with Windows 10/11 and macOS).</small></p>]]
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_text(props, "server", "Server URL", obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "token", "Token (blank = none)", obs.OBS_TEXT_PASSWORD)
  obs.obs_properties_add_text(props, "scene_name", "Scene name", obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_button(props, "btn_test", "Test connection", function()
    test_connection()
    return true
  end)
  obs.obs_properties_add_button(props, "btn_scene", "Create CG Live scene + sources", function()
    create_scene()
    return true
  end)
  obs.obs_properties_add_button(props, "btn_hide", "Hide all CG now", function()
    cmd_hide_all()
    return true
  end)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "server", "http://127.0.0.1:8080")
  obs.obs_data_set_default_string(settings, "token", "")
  obs.obs_data_set_default_string(settings, "scene_name", "CG Live")
end

function script_update(settings)
  server = obs.obs_data_get_string(settings, "server")
  token = obs.obs_data_get_string(settings, "token")
  scene_name = obs.obs_data_get_string(settings, "scene_name")
end

-- hotkeys ------------------------------------------------------------------ --
local function register(id, label, fn)
  local hk = obs.obs_hotkey_register_frontend(id, label, function(pressed)
    if pressed then fn() end
  end)
  hotkeys[id] = hk
  return hk
end

function script_load(settings)
  register("cglive_hide_all", "CG Live: hide all", cmd_hide_all)
  register("cglive_hide_main", "CG Live: hide main graphic", cmd_hide_main)
  for i = 1, ITEM_HOTKEYS do
    local idx = i
    register("cglive_item_" .. i, "CG Live: air item " .. i, function()
      cmd_air_item(idx)
    end)
  end
  -- restore each hotkey's saved bindings
  for id, hk in pairs(hotkeys) do
    local arr = obs.obs_data_get_array(settings, id)
    obs.obs_hotkey_load(hk, arr)
    obs.obs_data_array_release(arr)
  end
end

function script_save(settings)
  for id, hk in pairs(hotkeys) do
    local arr = obs.obs_hotkey_save(hk)
    obs.obs_data_set_array(settings, id, arr)
    obs.obs_data_array_release(arr)
  end
end

--[[
  No curl on this machine?
  Use an OBS *Python* script instead: point OBS at a Python 3 install
  (Tools -> Scripts -> Python Settings) and use urllib.request, which needs no
  external binary and opens no console window. The command bodies are the same
  JSON shown above:
      {"action":"l3HideAll"}
      {"action":"l3HideAll","keep":["top","ticker","bug"]}
      {"action":"l3Show","slot":"lower","type":"name","fields":{...},"style":{}}
]]
