/// <reference types="vite/client" />

// 静态资源模块声明（theme 包 Logo 等直接 import png/svg）
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
