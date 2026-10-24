// Keep ambiguous results separate; operators choose and verify the identifier.
export function findContainers(text) {
 const pattern=/(?<![A-Z0-9])([A-Z]{3}[UJZ])[\s-]*(\d(?:[\s-]*\d){6})(?![A-Z0-9])/g;
 return [...new Set([...text.toUpperCase().matchAll(pattern)].map(m=>m[1]+m[2].replace(/[\s-]/g,'')))];
}

export function validCheckDigit(code) {
 const letters={};let value=10;
 for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){if(value%11===0)value++;letters[letter]=value++;}
 if(!/^[A-Z]{4}\d{7}$/.test(code))return false;
 let sum=0;for(let n=0;n<10;n++)sum+=(letters[code[n]]??Number(code[n]))*2**n;
 return (sum%11)%10===Number(code[10]);
}
export function consolidateCandidates(codes) {
 // Discard a one-character OCR alternative only if a matching valid reading exists.
 return codes.filter(code=>validCheckDigit(code)||!codes.some(other=>validCheckDigit(other)&&code.slice(4)===other.slice(4)&&[...code].filter((char,i)=>char!==other[i]).length===1));
}
