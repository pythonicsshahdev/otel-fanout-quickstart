const Handlebars = require('handlebars');
const fs = require('fs');

function renderConfig(consumers, templatePath) {
  const source = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(source);
  return template({ consumers });
}

module.exports = { renderConfig };
