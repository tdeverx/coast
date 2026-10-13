const args=process.argv.slice(2), docker=args[0]==='--docker';if(docker)args.shift();
const name=args[0];
if(!name||!/^coast-(?:shutdown-fixture|lifecycle-test)[a-zA-Z0-9_-]*$/.test(name))throw Error('Pass a dedicated disposable Linux container with the candidate image and no running app/PG.');
const fixture=await Bun.file(new URL('./fixtures/container-runtime.ts',import.meta.url)).text();
const script=`set -eu\npath="$(mktemp /tmp/coast-runtime-test.XXXXXX.ts)"\ntrap 'rm -f "$path"' EXIT\ncat > "$path" <<'COAST_RUNTIME_SOURCE'\n${fixture}\nCOAST_RUNTIME_SOURCE\nbun "$path"\n`;
const child=Bun.spawn([docker?'docker':'container','exec',name,'/bin/bash','-c',script],{stdout:'inherit',stderr:'inherit'});
process.exitCode=await child.exited;
