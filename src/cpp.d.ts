declare type Module = any;

declare module "*.cpp" {
    export default function(): Promise<Module>;
}
declare module "*.c" {
    export default function(): Promise<Module>;
}