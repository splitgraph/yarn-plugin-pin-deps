/* eslint-disable */
//prettier-ignore
module.exports = {
name: "@yarnpkg/plugin-pin-deps",
factory: function (require) {
var plugin=(()=>{var c=Object.create,t=Object.defineProperty;var p=Object.getOwnPropertyDescriptor;var g=Object.getOwnPropertyNames;var h=Object.getPrototypeOf,u=Object.prototype.hasOwnProperty;var d=o=>t(o,"__esModule",{value:!0});var i=o=>{if(typeof require!="undefined")return require(o);throw new Error('Dynamic require of "'+o+'" is not supported')};var f=(o,n)=>{for(var a in n)t(o,a,{get:n[a],enumerable:!0})},k=(o,n,a)=>{if(n&&typeof n=="object"||typeof n=="function")for(let e of g(n))!u.call(o,e)&&e!=="default"&&t(o,e,{get:()=>n[e],enumerable:!(a=p(n,e))||a.enumerable});return o},r=o=>k(d(t(o!=null?c(h(o)):{},"default",o&&o.__esModule&&"default"in o?{get:()=>o.default,enumerable:!0}:{value:o,enumerable:!0})),o);var I={};f(I,{default:()=>y});var s=r(i("@yarnpkg/cli")),m=r(i("clipanion")),l=class extends s.BaseCommand{constructor(){super(...arguments);this.name=m.Option.String("--name","John Doe",{description:"Your name"})}async execute(){console.log(`Hello ${this.name}!`)}};l.paths=[["hello","world"]];var x={hooks:{afterAllInstalled:()=>{console.log("What a great install, am I right?")}},commands:[l]},y=x;return I;})();
return plugin;
}
};
