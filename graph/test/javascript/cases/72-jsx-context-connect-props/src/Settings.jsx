import { connect } from 'react-redux';

function Settings(props) {
  return <button onClick={props.onClickLogout}>out</button>;
}

const mapStateToProps = (state) => ({ user: state.user });
const mapDispatchToProps = (dispatch) => ({
  onClickLogout: () => dispatch({ type: 'LOGOUT' }),
});

export default connect(mapStateToProps, mapDispatchToProps)(Settings);
