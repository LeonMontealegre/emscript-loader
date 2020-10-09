const fs = require("fs");
const path = require("path");
const {dir} = require("tmp-promise");
const {exec} = require("child_process");
const {getOptions} = require("loader-utils");

const readFile = (path) => new Promise((resolve, reject) => {
    fs.readFile(path, "utf-8", (err, data) => {
        if (err)
            reject(err);
        resolve(data);
    });
});


module.exports = function loader() {
    const callback = this.async();

    const options = getOptions(this);

    const target = this.target;
    const inputFile = this.resourcePath;

    const CPP = (inputFile.endsWith(".cpp"));
    const fileName = path.basename(inputFile, (CPP ? ".cpp" : ".c"));

    (async () => {
        const {_, path, cleanup} = await dir({ unsafeCleanup: true });

        const jsPath = `${path}/${fileName}.js`;
        const wasmPath = `${path}/${fileName}.wasm`;

        // -s MODULARIZE=1 -s EXPORT_ES6=1 -s USE_ES6_IMPORT_META=0

        const includes = options.includes;

        const compiler = CPP ? "em++" : "emcc"

        const flags = ["-s WASM=1",
                       `-s ENVIRONMENT=${target}`,
                       ...includes.map(I => `-I ${I}`),
                       `${CPP ? "-std=c++11" : ""}`,
                       "-O3",
                       `-o ${jsPath}`];

        const cmd = `${compiler} ${inputFile} ${flags.join(" ")}`;

        const child = exec(cmd);
        child.on("error", (err) => {
            callback(err);
        });
        child.on("message", (msg) => {
            console.log("MESSAGE: ", msg);
        })
        child.on("exit", async (code) => {
            if (code != 0)
                callback(`${cmd} failed to run, with exit code ${code}!`);

            try {
                const data_js = await readFile(jsPath);
                const data_wasm = await readFile(wasmPath);

                this.emitFile(`${fileName}.wasm`, data_wasm);

                cleanup();

                callback(null, `
                    module.exports = function () {
                        ${data_js}

                        const keys = Object.keys(Module);
                        keys.forEach((key) => {
                            if (key.startsWith("_"))
                                Module[key.substring(1)] = Module[key];
                        });

                        return new Promise((resolve, reject) => {
                            Module.onRuntimeInitialized = () => resolve(Module);
                        });
                    }
                `);
            } catch(e) {
                cleanup();

                callback(e);
            }
        });
    })();
}