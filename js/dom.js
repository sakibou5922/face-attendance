// 小さな DOM ヘルパー。ユーザー入力は必ず text（textContent）で渡す
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  node.append(...[].concat(children));
  return node;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
