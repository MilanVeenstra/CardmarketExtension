// Checks that a downloaded version of Cart Saver can load, before the
// auto-updater puts it in place of the working one: the manifest and the
// translations are valid JSON and every script parses.
//
//   osascript -l JavaScript scripts/check-build.js /path/to/the/new/version
//
// (JavaScript for Automation: part of every Mac, nothing to install.)
ObjC.import('Foundation');

function read(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (!text || text.isNil()) throw new Error(`missing: ${path}`);
  return ObjC.unwrap(text);
}

function run(argv) {
  const dir = argv[0];
  if (!dir) throw new Error('usage: check-build.js <folder>');

  const manifest = JSON.parse(read(`${dir}/manifest.json`));
  for (const lang of ['en', 'nl']) JSON.parse(read(`${dir}/_locales/${lang}/messages.json`));

  const scripts = new Set();
  if (manifest.background && manifest.background.service_worker) scripts.add(manifest.background.service_worker);
  for (const entry of manifest.content_scripts || []) for (const file of entry.js || []) scripts.add(file);
  const files = $.NSFileManager.defaultManager.enumeratorAtPath(`${dir}/src`);
  for (let next = files.nextObject; next && !next.isNil(); next = files.nextObject) {
    const name = ObjC.unwrap(next);
    if (name.endsWith('.js')) scripts.add(`src/${name}`);
  }

  for (const file of scripts) {
    try {
      new Function(read(`${dir}/${file}`)); // parses only, runs nothing
    } catch (err) {
      throw new Error(`${file}: ${err.message}`);
    }
  }
  return `ok: manifest ${manifest.version}, ${scripts.size} scripts`;
}
