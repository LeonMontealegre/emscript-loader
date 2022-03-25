const fs = require("fs");
const path = require("path");
const {dir} = require("tmp-promise");
const {exec} = require("child_process");
const {getOptions} = require("loader-utils");


const readFile = (path, type) => new Promise((resolve, reject) => {
    fs.readFile(path, type, (err, data) => {
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
        const dataPath = `${path}/${fileName}.data`;

        // -s MODULARIZE=1 -s EXPORT_ES6=1 -s USE_ES6_IMPORT_META=0

        const includes = options.includes;
        const data = options.data || [];
        const useGL = options.useGL || false;
        const extraFlags = options.extraFlags || [];
        const exportedFuncs = ["_free", "_malloc", ...(options.exportedFuncs || [])];

        const compiler = CPP ? "em++" : "emcc"

        const flags = ["-s WASM=1",
                       `${CPP ? "-std=c++11" : ""}`,
                       `-s ENVIRONMENT=${target}`,
                       `-s EXPORTED_FUNCTIONS="[${exportedFuncs.map(s => `'${s}'`).join(",")}]"`,
                       ...(useGL ? ["-lGL", "-lglfw", "-s USE_GLFW=3", "-s USE_WEBGL2=1"] : []),
                       ...includes.map(I => `-I ${I}`),
                       ...data.map(D => `--preload-file ${D}`),
                       ...extraFlags,
                       `-o ${jsPath}`];

        const cmd = `${compiler} ${inputFile} ${flags.join(" ")}`;

        const child = exec(cmd, (err, stdout, stderr) => {
            console.error(stdout);
            console.error(stderr);
        });
        child.on("error", (err) => {
            callback(err);
        });
        child.on("message", (msg) => {
            console.log("MESSAGE: ", msg);
        })
        child.on("exit", async (code) => {
            if (code != 0) {
                callback(`${cmd} failed to run, with exit code ${code}!`);
                return;
            }

            try {
                const data_js = await readFile(jsPath, "utf-8");
                const data_wasm = await readFile(wasmPath, null);
                const data_extra = (fs.existsSync(dataPath) ? await readFile(dataPath, null) : "");

                this.emitFile(`${fileName}.wasm`, data_wasm);
                this.emitFile(`${fileName}.data`, data_extra);

                cleanup();

                // NOTE: You are not allowed to reassign Module
                callback(null, `
                    module.exports = function (data) {
                        ${data_js}

                        const keys = Object.keys(Module);
                        keys.forEach((key) => {
                            if (key.startsWith("_"))
                                Module[key.substring(1)] = Module[key];
                        });

                        Object.entries(data || {}).forEach(([key, val]) => {
                            Module[key] = val;
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