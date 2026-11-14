import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAsset, approveAsset, loadCatalog, validateCatalog } from './catalog.mjs';

// CLI: import a licensed recording, approve it after listening, or validate the whole catalog
//   node tools/audio/import.mjs add --file <audio> --id <id> --category <c> --description "<d>" --license CC0-1.0 \
//        --source-url <page> --author "<name>" --evidence "<where the license is stated>" [--attribution "<credit>"] [--gain-db -18] [--loop]
//   node tools/audio/import.mjs approve <id> --by "<name>"
//   node tools/audio/import.mjs validate
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  const go = async () => {
    if (command === 'add') return print(await importAsset({file:resolve(process.cwd(), opt('--file') ?? ''), id:opt('--id'), category:opt('--category'), description:opt('--description'), license:opt('--license'),
      sourceUrl:opt('--source-url'), author:opt('--author'), evidence:opt('--evidence'), attribution:opt('--attribution'), gainDb:Number(opt('--gain-db') ?? -18), loop:rest.includes('--loop')}));
    if (command === 'approve') return print(await approveAsset(rest[0], {by:opt('--by'), notes:opt('--notes') ?? ''}));
    if (command === 'validate') { const problems = await validateCatalog(await loadCatalog()); print(problems.length ? problems : 'audio catalog OK'); if (problems.length) process.exitCode = 1; return; }
    throw new Error('Usage: import.mjs add ... | approve <id> --by "<name>" | validate');
  };
  go().catch(err => { console.error(err.message); process.exitCode = 1; });
}
