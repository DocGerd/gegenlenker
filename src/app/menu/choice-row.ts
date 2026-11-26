import { t } from '../../i18n/i18n';
import { labelOf, type ChoiceField } from './options';
import { element } from './screens/frame';

/**
 * A labelled radio group with every value visible; arrow keys change the value natively. `onChange` gets the
 * newly checked value.
 */
export function choiceRow(
  field: ChoiceField,
  value: string,
  onChange: (value: string) => void,
): HTMLFieldSetElement {
  const row = element('fieldset', 'choice-row');
  row.setAttribute('role', 'radiogroup');
  row.dataset['menu'] = field.id;
  const legend = element('legend', 'choice-row-label', t(field.label));
  legend.id = `option-${field.id}-label`;
  row.setAttribute('aria-labelledby', legend.id);

  const labels = field.choices.map(labelOf);
  const values = element('div', 'choice-row-values');
  // Below this width the values no longer fit one line, and the row becomes a list.
  values.style.setProperty(
    '--choice-row-chars',
    `${labels.reduce((sum, label) => sum + label.length, 0)}`,
  );
  values.style.setProperty('--choice-row-count', `${labels.length}`);
  values.append(
    ...field.choices.map((choice, index) => {
      const label = element('label', 'choice');
      const radio = element('input', 'choice-radio');
      radio.type = 'radio';
      radio.name = `option-${field.id}`;
      radio.value = choice.value;
      radio.checked = choice.value === value;
      radio.addEventListener('change', () => {
        if (radio.checked) onChange(choice.value);
      });
      label.append(radio, element('span', 'choice-text', labels[index]));
      return label;
    }),
  );
  row.append(legend, values);
  return row;
}
