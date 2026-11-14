import { resolve } from 'node:path';
import { registerAsset } from './convert/register.mjs';

async function main(args) {
  let reportPath, approve = false, approvedBy, catalogId, style, replace = false;
  const tags = [];
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--report') reportPath=args[++i];
    else if (args[i] === '--approve') approve=true;
    else if (args[i] === '--approved-by') approvedBy=args[++i];
    else if (args[i] === '--id') catalogId=args[++i];
    else if (args[i] === '--style') style=args[++i];
    else if (args[i] === '--tag') tags.push(args[++i]);
    else if (args[i] === '--replace') replace=true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!reportPath) throw new Error('Provide --report <assets/converted/.../report.json>');
  const result = await registerAsset(resolve(process.cwd(), reportPath), {approve, approvedBy, catalogId, style, tags, replace});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
