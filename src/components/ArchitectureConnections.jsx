import { useId, useState } from 'react';
import { CONNECTIONS, TOPICS } from '../data/architectureStory';

const TOPIC_IDS = Object.keys(TOPICS);

function Pair({ link, onSelect })
{
	const [a, b, label, description] = link;
	return <>
		<div className="pair-topics">
			<button type="button" onClick={() => onSelect(a)}>{TOPICS[a][0]}</button>
			<span aria-hidden="true">×</span>
			<button type="button" onClick={() => onSelect(b)}>{TOPICS[b][0]}</button>
		</div>
		<p><strong>{label}.</strong> {description}</p>
	</>;
}

export default function ArchitectureConnections({ initialTopic, onSelect })
{
	const [
	   selected,
	   setSelected
	] = useState(() => CONNECTIONS.find(link => link.slice(0, 2).includes(initialTopic)) || CONNECTIONS[0]);
	const detailId = useId();
	return (
		<div className="connection-map">
			<div className="connection-map-wide">
				<p className="reference-summary">Each dot joins two topics. Select it to read the implementation constraint they share.</p>
				<table className="connection-matrix" aria-label="Documented connections between architecture topics">
					<thead><tr><td />{TOPIC_IDS.map(id => <th key={id} scope="col" data-active={selected[0] === id || selected[1] === id}><span>{TOPICS[id][0]}</span></th>)}</tr></thead>
					<tbody>{TOPIC_IDS.map((row, index) => <tr key={row}>
						<th scope="row" data-active={selected[0] === row || selected[1] === row}>{TOPICS[row][0]}</th>
						{TOPIC_IDS.map((column, columnIndex) =>
						{
							// Mirror the pair visually. Keyboard navigation visits each pair once.
							const link = row !== column && CONNECTIONS.find(([
							   a,
							   b
							]) => (a === row && b === column) || (a === column && b === row));
							return <td key={column} className="matrix-cell">
								{link && <button type="button" tabIndex={columnIndex > index ? 0 : -1} aria-pressed={selected === link} aria-controls={detailId}
									title={link[3]} aria-label={TOPICS[row][0] + ' and ' + TOPICS[column][0] + ' · ' + link[2]}
									onFocus={() => setSelected(link)} onClick={() => setSelected(link)}><span /></button>}
							</td>;
						})}
					</tr>)}</tbody>
				</table>
				<div className="pair-detail" id={detailId} aria-live="polite" aria-atomic="true"><Pair link={selected} onSelect={onSelect} /></div>
			</div>
			<ul className="connection-map-narrow" aria-label="Documented connections between architecture topics">
				{CONNECTIONS.map(link => <li key={link[0] + '/' + link[1]}><Pair link={link} onSelect={onSelect} /></li>)}
			</ul>
		</div>
	);
}
