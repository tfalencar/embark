import React, {Component} from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {contracts as contractsAction} from "../actions";

import Contracts from '../components/Contracts';
import DataWrapper from "../components/DataWrapper";
import PageHead from "../components/PageHead";
import {getContracts} from "../reducers/selectors";

class ContractsContainer extends Component {
  componentDidMount() {
    this.props.fetchContracts();
  }

  render() {
    return (
      <React.Fragment>
        <PageHead title="Contracts" description="Summary of all deployed contracts" />
        <DataWrapper shouldRender={this.props.contracts.length > 0} {...this.props} render={({contracts}) => (
            <Contracts contracts={contracts} />
        )} />
      </React.Fragment>
    );
  }
}

function mapStateToProps(state) {
  return {
    contracts: getContracts(state), 
    error: state.errorMessage, 
    loading: state.loading};
}

ContractsContainer.propTypes = {
  contracts: PropTypes.array,
  fiddleContracts: PropTypes.array,
  fetchContracts: PropTypes.func
};

export default connect(
  mapStateToProps,{
    fetchContracts: contractsAction.request
  }
)(ContractsContainer);
