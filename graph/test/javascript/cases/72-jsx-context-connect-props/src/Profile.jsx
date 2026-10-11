import React from 'react';
import { connect } from 'react-redux';

function saveProfile() { return { type: 'SAVE' }; }

// a class component reads this.props; mapDispatch in its object form
class Profile extends React.Component {
  render() {
    const { onSave } = this.props;
    return <form onSubmit={onSave}><button onClick={this.props.onSave}>save</button></form>;
  }
}

export default connect(null, { onSave: saveProfile })(Profile);

function openFavorites() { return { type: 'OPEN' }; }

// CONTROL: a subclass connected on its own reads its own props, not Profile's onSave
class Favorites extends Profile {
  footer() {
    return <p onClick={this.props.onOpen} onBlur={this.props.onSave}>more</p>;
  }
}

export const ConnectedFavorites = connect(null, { onOpen: openFavorites })(Favorites);
